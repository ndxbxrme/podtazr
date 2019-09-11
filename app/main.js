(function() {
  'use strict';
  var BrowserWindow, ObjectID, Parser, Pusher, PusherJs, app, appChannel, autoUpdater, child, db, fetchAndUpsertPodcast, fetchPodcast, fs, ipcMain, keys, mainWindow, objectEncryptor, onSync, openJoinWindow, parser, path, pusherRec, pusherSend, ready, refreshFeeds, reportListen, sanitizeUrl, sync, url, user;

  ({app, BrowserWindow, ipcMain} = require('electron'));

  ({autoUpdater} = require('electron-updater'));

  url = require('url');

  path = require('path');

  Parser = require('rss-parser');

  fs = require('fs-extra');

  objectEncryptor = require('object-encryptor');

  keys = require('./keys.json');

  ObjectID = require('bson-objectid');

  Pusher = require('pusher');

  PusherJs = require('pusher-js');

  objectEncryptor = require('object-encryptor');

  pusherSend = null;

  pusherRec = null;

  appChannel = null;

  parser = new Parser();

  db = null;

  user = null;

  mainWindow = null;

  child = null;

  sync = async function() {
    var data;
    data = {
      clientID: user.clientID,
      channelID: user.channelID,
      date: new Date().valueOf(),
      lastSyncDate: user.lastSyncDate
    };
    data.listens = (await db.select('listens', {
      date: {
        $gt: user.lastSyncDate
      }
    }));
    data.subscriptions = (await db.select('subscriptions', {
      date: {
        $gt: user.lastSyncDate
      }
    }));
    pusherSend.trigger('global', 'sync', data);
    return pusherSend.trigger('app-' + user.channelID, 'sync', data);
  };

  onSync = async function(data) {
    var upsertListens, upsertSubscriptions;
    if (data.clientID === user.clientID) {
      return;
    }
    upsertListens = function(listens) {
      var i, len, listen, results;
      results = [];
      for (i = 0, len = listens.length; i < len; i++) {
        listen = listens[i];
        delete listen.channelID;
        results.push(db.upsert('listens', listen, {
          url: listen.url
        }));
      }
      return results;
    };
    upsertSubscriptions = function(subscriptions) {
      var i, len, results, subscription;
      results = [];
      for (i = 0, len = subscriptions.length; i < len; i++) {
        subscription = subscriptions[i];
        delete subscription.channelID;
        results.push(db.upsert('subscriptions', subscription, {
          url: subscription.url,
          date: subscription.date
        }));
      }
      return results;
    };
    if (data.listens) {
      upsertListens(data.listens);
    }
    if (data.subscriptions) {
      upsertSubscriptions(data.subscriptions);
    }
    user.lastSyncDate = data.date;
    db.update('users', user, {
      _id: user._id
    });
    return mainWindow.webContents.send('podcasts', (await refreshFeeds()));
  };

  ready = async function() {
    keys = (await objectEncryptor.decrypt(keys, ['pusher']));
    pusherSend = new Pusher(keys.pusher);
    pusherRec = new PusherJs(keys.pusher.key, {
      cluster: keys.pusher.cluster,
      forceTLS: keys.pusher.useTLS
    });
    autoUpdater.checkForUpdatesAndNotify();
    return db = require('ndxdb').config({
      database: 'db',
      tables: ['podcasts', 'subscriptions', 'users', 'listens'],
      localStorage: path.join(app.getPath('userData'), 'data'),
      autoId: '_id',
      doNotEncrypt: true
    }).on('ready', async function() {
      var options, saveWindowPosition;
      //db.delete 'listens'
      //db.delete 'users'
      //db.delete 'subscriptions'
      //db.delete 'podcasts'
      user = (await db.selectOne('users'));
      console.log(user);
      if (!user) {
        user = (await db.insert('users', {
          clientID: ObjectID.generate(),
          channelID: ObjectID.generate(),
          lastSyncDate: 0,
          width: 800,
          height: 600
        }));
        openJoinWindow();
      }
      options = {
        width: user.width || 800,
        height: user.height || 600,
        autoHideMenuBar: true
      };
      if (typeof user.x === 'number') {
        options.x = user.x;
        options.y = user.y;
      }
      mainWindow = new BrowserWindow(options);
      mainWindow.on('closed', function() {
        return mainWindow = null;
      });
      mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file:',
        slashes: true
      }));
      saveWindowPosition = function() {
        var pos, size;
        size = mainWindow.getSize();
        pos = mainWindow.getPosition();
        user.width = size[0];
        user.height = size[1];
        user.x = pos[0];
        user.y = pos[1];
        console.log('saving user', user);
        return db.update('users', user, {
          _id: user._id
        });
      };
      mainWindow.on('resize', saveWindowPosition);
      mainWindow.on('move', saveWindowPosition);
      mainWindow.openDevTools();
      appChannel = pusherRec.subscribe('app-' + user.channelID);
      appChannel.bind('sync', function(data) {
        return onSync(data);
      });
      return sync();
    }).start();
  };

  app.on('ready', function() {
    return mainWindow || ready();
  });

  app.on('window-all-closed', function() {
    return process.platform === 'darwin' || app.quit();
  });

  app.on('activiate', function() {
    return mainWindow || ready();
  });

  sanitizeUrl = function(url) {
    return url;
  };

  fetchAndUpsertPodcast = async function(url) {
    var podcast;
    console.log('upsert', url);
    podcast = (await parser.parseURL(url));
    podcast.url = url;
    podcast.lastVisited = new Date();
    db.upsert('podcasts', podcast, {
      url: podcast.url
    });
    return podcast;
  };

  fetchPodcast = async function(url) {
    var dbPodcast, podcast;
    console.log('fetch', url);
    url = sanitizeUrl(url);
    dbPodcast = (await db.selectOne('podcasts', {
      url: url
    }));
    if (dbPodcast) {
      if (new Date(dbPodcast.lastVisited).valueOf() + (2 * 60 * 60 * 1000) < new Date().valueOf()) {
        console.log(1, new Date(new Date(dbPodcast.lastVisited).valueOf() + (2 * 60 * 60 * 1000)), new Date());
        podcast = (await fetchAndUpsertPodcast(url));
        return podcast;
      }
    } else {
      console.log(0);
      dbPodcast = (await fetchAndUpsertPodcast(url));
    }
    return dbPodcast;
  };

  reportListen = async function(details, context) {
    var listens;
    db.upsert('listens', details, {
      url: details.url
    });
    listens = (await db.select('listens'));
    pusherSend.trigger('app-' + user.channelID, 'report-listens', {
      channelID: user.channelID,
      clientID: user.clientID,
      listens: [details]
    });
    if (context === 'global') {
      details.channelID = user.channelID;
      return pusherSend.trigger('global', 'report-listens', {
        channelID: user.channelID,
        clientID: user.clientID,
        listens: [details]
      });
    }
  };

  refreshFeeds = async function() {
    var i, j, len, len1, listens, mysubs, podcast, podcasts, subscription, subscriptions;
    subscriptions = (await db.select('subscriptions'));
    subscriptions.sort(function(a, b) {
      if (a.date > b.date) {
        return 1;
      } else {
        return -1;
      }
    });
    mysubs = {};
    for (i = 0, len = subscriptions.length; i < len; i++) {
      subscription = subscriptions[i];
      mysubs[subscription.url] = subscription.status;
    }
    mysubs = Object.keys(mysubs).filter(function(key) {
      return mysubs[key];
    });
    podcasts = [];
    for (j = 0, len1 = mysubs.length; j < len1; j++) {
      subscription = mysubs[j];
      podcast = (await fetchPodcast(subscription));
      podcasts.push(podcast);
    }
    listens = (await db.select('listens'));
    return {
      podcasts: podcasts,
      listens: listens
    };
  };

  ipcMain.on('get-user', function(win) {
    return win.sender.webContents.send('user', user);
  });

  ipcMain.on('add-podcast', async function(win, url) {
    var podcast, sub;
    podcast = (await fetchPodcast(url));
    if (podcast) {
      sub = {
        url: url,
        status: true,
        date: new Date().valueOf()
      };
      await db.insert('subscriptions', sub);
      sub.channelID = user.channelID;
      pusherSend.trigger('app-' + user.channelID, 'report-subscriptions', {
        channelID: user.channelID,
        clientID: user.clientID,
        subscriptions: [sub]
      });
      pusherSend.trigger('global', 'report-subscriptions', {
        channelID: user.channelID,
        clientID: user.clientID,
        subscriptions: [sub]
      });
    }
    return win.sender.webContents.send('podcasts', (await refreshFeeds()));
  });

  ipcMain.on('get-podcasts', async function(win, url) {
    return win.sender.webContents.send('podcasts', (await refreshFeeds()));
  });

  ipcMain.on('get-listens', async function(win) {
    var listens;
    listens = (await db.select('listens'));
    return win.sender.webContents.send('listens', listens);
  });

  ipcMain.on('check-for-new', async function(win) {
    var i, len, newPodcast, podcast, podcasts, updated;
    console.log('check for new');
    //data = await refreshFeeds()
    //mainWindow.webContents.send 'podcasts', data
    podcasts = (await db.select('podcasts'));
    updated = [];
    for (i = 0, len = podcasts.length; i < len; i++) {
      podcast = podcasts[i];
      newPodcast = (await fetchPodcast(podcast.url));
      if (newPodcast.lastUpdated !== podcast.lastUpdated) {
        updated.push(newPodcast);
      }
    }
    console.log(updated.length);
    if (updated.length) {
      //mainWindow.webContents.send 'update-podcasts', updated
      return win.sender.webContents.send('podcasts', (await refreshFeeds()));
    }
  });

  ipcMain.on('app-listen', function(win, details) {
    return reportListen(details, 'app');
  });

  ipcMain.on('global-listen', function(win, details) {
    return reportListen(details, 'global');
  });

  ipcMain.on('get-channel', async function(win) {
    var myobj;
    myobj = {
      channelID: user.channelID
    };
    myobj = (await objectEncryptor.encrypt(myobj, ['channelID']));
    child = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      show: false,
      autoHideMenuBar: true,
      width: 435,
      height: 140
    });
    child.on('closed', function() {
      return child = null;
    });
    child.loadURL(url.format({
      pathname: path.join(__dirname, 'get-channel.html'),
      protocol: 'file:',
      slashes: true
    }));
    child.once('ready-to-show', function() {
      child.show();
      return child.webContents.send('channel-id', myobj.channelID);
    });
    return console.log(myobj.channelID);
  });

  openJoinWindow = function() {
    child = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      show: false,
      autoHideMenuBar: true,
      width: 435,
      height: 140
    });
    child.on('closed', function() {
      return child = null;
    });
    child.loadURL(url.format({
      pathname: path.join(__dirname, 'join-channel.html'),
      protocol: 'file:',
      slashes: true
    }));
    return child.once('ready-to-show', function() {
      return child.show();
    });
  };

  ipcMain.on('join-channel', openJoinWindow);

  ipcMain.on('set-channel-id', async function(win, channelID) {
    var myobj;
    myobj = {
      channelID: channelID
    };
    console.log(myobj);
    myobj = (await objectEncryptor.decrypt(myobj, ['channelID']));
    console.log(myobj);
    if (myobj.channelID) {
      user.channelID = myobj.channelID;
      user.lastSyncDate = 0;
      db.update('users', user, {
        _id: user._id
      });
      db.delete('podcasts');
      db.delete('subscriptions');
      db.delete('listens');
      child.close();
      appChannel = pusherRec.subscribe('app-' + user.channelID);
      appChannel.bind('sync', function(data) {
        console.log('sync called');
        console.log(data);
        return onSync(data);
      });
      return (await sync());
    }
  });

}).call(this);

//# sourceMappingURL=main.js.map
