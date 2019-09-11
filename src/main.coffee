'use strict'

{app, BrowserWindow, ipcMain} = require 'electron'
{autoUpdater} = require 'electron-updater'
url = require 'url'
path = require 'path'
Parser = require 'rss-parser'
fs = require 'fs-extra'
objectEncryptor = require 'object-encryptor'
keys = require './keys.json'
ObjectID = require 'bson-objectid'
Pusher = require 'pusher'
PusherJs = require 'pusher-js'
objectEncryptor = require 'object-encryptor'
pusherSend = null
pusherRec = null
appChannel = null
parser = new Parser()
db = null
user = null

mainWindow = null
child = null
  
sync = ->
  data =
    clientID: user.clientID
    channelID: user.channelID
    date: new Date().valueOf()
    lastSyncDate: user.lastSyncDate
  data.listens = await db.select 'listens',
    date:
      $gt: user.lastSyncDate
  data.subscriptions = await db.select 'subscriptions',
    date:
      $gt: user.lastSyncDate
  pusherSend.trigger 'global', 'sync', data
  pusherSend.trigger 'app-' + user.channelID, 'sync', data
  
onSync = (data) ->
  return if data.clientID is user.clientID
  upsertListens = (listens) ->
    for listen in listens
      delete listen.channelID
      db.upsert 'listens', listen,
        url: listen.url
  upsertSubscriptions = (subscriptions) ->
    for subscription in subscriptions
      delete subscription.channelID
      db.upsert 'subscriptions', subscription,
        url: subscription.url
        date: subscription.date
  upsertListens data.listens if data.listens
  upsertSubscriptions data.subscriptions if data.subscriptions
  user.lastSyncDate = data.date
  db.update 'users', user,
    _id: user._id
  mainWindow.webContents.send 'podcasts', await refreshFeeds()

ready = ->
  keys = await objectEncryptor.decrypt keys, ['pusher']  
  pusherSend = new Pusher keys.pusher
  pusherRec = new PusherJs keys.pusher.key,
    cluster: keys.pusher.cluster
    forceTLS: keys.pusher.useTLS
  autoUpdater.checkForUpdatesAndNotify()
  db = require 'ndxdb'
  .config
    database: 'db'
    tables: ['podcasts', 'subscriptions', 'users', 'listens']
    localStorage: path.join app.getPath('userData'), 'data'
    autoId: '_id'
    doNotEncrypt: true
  .on 'ready', ->
    #db.delete 'listens'
    #db.delete 'users'
    #db.delete 'subscriptions'
    #db.delete 'podcasts'
    user = await db.selectOne 'users'
    console.log user
    if not user
      user = await db.insert 'users',
        clientID: ObjectID.generate()
        channelID: ObjectID.generate()
        lastSyncDate: 0
        width: 800
        height: 600
      openJoinWindow()
    options = 
      width: user.width or 800
      height: user.height or 600
      autoHideMenuBar: true
    if typeof(user.x) is 'number'
      options.x = user.x
      options.y = user.y
    mainWindow = new BrowserWindow options
    mainWindow.on 'closed', ->
      mainWindow = null
    mainWindow.loadURL url.format
      pathname: path.join __dirname, 'index.html'
      protocol: 'file:'
      slashes: true
    saveWindowPosition = ->
      size = mainWindow.getSize()
      pos = mainWindow.getPosition()
      user.width = size[0]
      user.height = size[1]
      user.x = pos[0]
      user.y = pos[1]
      console.log 'saving user', user
      db.update 'users', user,
        _id: user._id
    mainWindow.on 'resize', saveWindowPosition
    mainWindow.on 'move', saveWindowPosition
    #mainWindow.openDevTools()
    appChannel = pusherRec.subscribe 'app-' + user.channelID
    appChannel.bind 'sync', (data) ->
      onSync data
    sync()
  .start()
app.on 'ready', ->
  mainWindow or ready()
app.on 'window-all-closed', ->
  process.platform is 'darwin' or app.quit()
app.on 'activiate', ->
  mainWindow or ready()
  
sanitizeUrl = (url) ->
  url
  
fetchAndUpsertPodcast = (url) ->
  console.log 'upsert', url
  podcast = await parser.parseURL url
  podcast.url = url
  podcast.lastVisited = new Date()
  db.upsert 'podcasts', podcast,
    url: podcast.url
  return podcast
  
fetchPodcast = (url) ->
  console.log 'fetch', url
  url = sanitizeUrl url
  dbPodcast = await db.selectOne 'podcasts',
    url: url
  if dbPodcast
    if new Date(dbPodcast.lastVisited).valueOf() + (2 * 60 * 60 * 1000) < new Date().valueOf()
      console.log 1, new Date(new Date(dbPodcast.lastVisited).valueOf() + (2 * 60 * 60 * 1000)), new Date()
      podcast = await fetchAndUpsertPodcast url
      return podcast
  else
    console.log 0
    dbPodcast = await fetchAndUpsertPodcast url
  return dbPodcast
  
reportListen = (details, context) ->
  db.upsert 'listens', details,
    url: details.url
  listens = await db.select 'listens'
  pusherSend.trigger 'app-' + user.channelID, 'report-listens', 
    channelID: user.channelID
    clientID: user.clientID
    listens: [details]
  if context is 'global'
    details.channelID = user.channelID
    pusherSend.trigger 'global', 'report-listens', 
      channelID: user.channelID
      clientID: user.clientID
      listens: [details]
  
refreshFeeds = ->
  subscriptions = await db.select 'subscriptions'
  subscriptions.sort (a,b) ->
    if a.date > b.date then 1 else -1
  mysubs = {}
  for subscription in subscriptions
    mysubs[subscription.url] = subscription.status
  mysubs = Object.keys(mysubs).filter (key) -> mysubs[key]
  podcasts = []
  for subscription in mysubs
    podcast = await fetchPodcast subscription
    podcasts.push podcast
  listens = await db.select 'listens'
  podcasts: podcasts
  listens: listens
  
ipcMain.on 'get-user', (win) ->
  win.sender.webContents.send 'user', user
ipcMain.on 'add-podcast', (win, url) ->
  podcast = await fetchPodcast url
  if podcast
    sub =
      url: url
      status: true
      date: new Date().valueOf()
    await db.insert 'subscriptions', sub
    sub.channelID = user.channelID
    pusherSend.trigger 'app-' + user.channelID, 'report-subscriptions', 
      channelID: user.channelID
      clientID: user.clientID
      subscriptions: [sub]
    pusherSend.trigger 'global', 'report-subscriptions', 
      channelID: user.channelID
      clientID: user.clientID
      subscriptions: [sub]
  win.sender.webContents.send 'podcasts', await refreshFeeds()
ipcMain.on 'get-podcasts', (win, url) ->
  win.sender.webContents.send 'podcasts', await refreshFeeds()
ipcMain.on 'get-listens', (win) ->
  listens = await db.select 'listens'
  win.sender.webContents.send 'listens', listens
ipcMain.on 'check-for-new', (win) ->
  console.log 'check for new'
  #data = await refreshFeeds()
  #mainWindow.webContents.send 'podcasts', data
  podcasts = await db.select 'podcasts'
  updated = []
  for podcast in podcasts
    newPodcast = await fetchPodcast podcast.url
    if newPodcast.lastUpdated isnt podcast.lastUpdated
      updated.push newPodcast
  console.log updated.length
  if updated.length
    #mainWindow.webContents.send 'update-podcasts', updated
    win.sender.webContents.send 'podcasts', await refreshFeeds()
ipcMain.on 'app-listen', (win, details) ->
  reportListen details, 'app'
ipcMain.on 'global-listen', (win, details) ->
  reportListen details, 'global'
ipcMain.on 'get-channel', (win) ->
  myobj =
    channelID: user.channelID
  myobj = await objectEncryptor.encrypt myobj, ['channelID']
  child = new BrowserWindow
    parent: mainWindow
    modal: true
    show: false
    autoHideMenuBar: true
    width: 435
    height: 140
  child.on 'closed', ->
    child = null
  child.loadURL url.format
    pathname: path.join __dirname, 'get-channel.html'
    protocol: 'file:'
    slashes: true
  child.once 'ready-to-show', ->
    child.show()
    child.webContents.send 'channel-id', myobj.channelID
  console.log myobj.channelID
openJoinWindow = ->
  child = new BrowserWindow
    parent: mainWindow
    modal: true
    show: false
    autoHideMenuBar: true
    width: 435
    height: 140
  child.on 'closed', ->
    child = null
  child.loadURL url.format
    pathname: path.join __dirname, 'join-channel.html'
    protocol: 'file:'
    slashes: true
  child.once 'ready-to-show', ->
    child.show()
ipcMain.on 'join-channel', openJoinWindow
ipcMain.on 'set-channel-id', (win, channelID) ->
  myobj =
    channelID: channelID
  console.log myobj
  myobj = await objectEncryptor.decrypt myobj, ['channelID']
  console.log myobj
  if myobj.channelID
    user.channelID = myobj.channelID
    user.lastSyncDate = 0
    db.update 'users', user,
      _id: user._id
    db.delete 'podcasts'
    db.delete 'subscriptions'
    db.delete 'listens'
    child.close()
    appChannel = pusherRec.subscribe 'app-' + user.channelID
    appChannel.bind 'sync', (data) ->
      console.log 'sync called'
      console.log data
      onSync data
    await sync()