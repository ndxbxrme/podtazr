(function() {
  var $filterAll, $filterMonth, $filterWeek, $items, $optionsSortBackwards, $optionsSortForwards, $player, $playerFeedTitle, $playerImage, $playerNext, $playerPlay, $playerPodTitle, $playerPositionBar, $playerPositionCurrent, $playerPositionDuration, $playerPrev, $playerStop, $playerVolumeBar, $searchResults, $spinner, DateFormat, Parser, addPodcast, allItems, audioElm, autoplay, changeSort, clearPlayState, currentElm, currentFeed, currentItem, dateFilter, dateFormat, dateFrom, dateRanges, dateTo, debounce, doReportListenStatus, draw, duration, fetchPodcast, fetchRssFeeds, formatDuration, getChannel, googleIt, hideSpinner, ipcRenderer, joinChannel, listens, main, next, parser, play, podcasts, prev, renderItems, renderPlayer, renderPodcasts, renderSidebar, reportListenStatus, sanitize, searchPodcasts, setDateFilter, setPageState, setPlayState, setPosition, setStatusFilter, setVolume, setupAudio, showFeed, showPodcastEpisodes, showSpinner, showSubscriptions, sort, sortDir, statusFilter, stop, throttle, twas, updateDateFilter, updateStatusFilter, user, viz;

  ({ipcRenderer} = require('electron'));

  googleIt = require('google-it');

  DateFormat = require('fast-date-format');

  dateFormat = new DateFormat('hA, ddd DD MMM YYYY');

  duration = require('format-duration-time').default;

  Parser = require('rss-parser');

  parser = new Parser();

  twas = require('twas');

  viz = null;

  user = null;

  audioElm = document.querySelector('audio');

  currentItem = null;

  currentElm = null;

  currentFeed = null;

  autoplay = true;

  dateFilter = 'week';

  statusFilter = 'unlistened';

  dateFrom = new Date().valueOf() - 7 * 24 * 60 * 60 * 1000;

  dateTo = Number.MAX_SAFE_INTEGER;

  sort = 'pubDate';

  allItems = [];

  podcasts = [];

  listens = null;

  sortDir = -1;

  dateRanges = [
    {
      time: 24 * 60 * 60 * 1000,
      name: 'Today'
    },
    {
      time: 48 * 60 * 60 * 1000,
      name: 'Yesterday'
    },
    {
      time: 7 * 24 * 60 * 60 * 1000,
      name: 'This week'
    },
    {
      time: 14 * 24 * 60 * 60 * 1000,
      name: 'Last week'
    },
    {
      time: 31 * 24 * 60 * 60 * 1000,
      name: 'This month'
    },
    {
      time: 62 * 24 * 60 * 60 * 1000,
      name: 'Last month'
    },
    {
      time: Number.MAX_SAFE_INTEGER,
      name: 'Older'
    }
  ];

  $items = document.querySelector('.items');

  $searchResults = document.querySelector('.search-results');

  $player = document.querySelector('.player');

  $playerPodTitle = document.querySelector('.player .pod .title');

  $playerFeedTitle = document.querySelector('.player .pod .feed-title');

  $playerImage = document.querySelector('.player .pod-image');

  $playerPositionCurrent = document.querySelector('.player .position .current');

  $playerPositionDuration = document.querySelector('.player .position .duration');

  $playerPrev = document.querySelector('.player .prev');

  $playerNext = document.querySelector('.player .next');

  $playerPlay = document.querySelector('.player .play');

  $playerStop = document.querySelector('.player .stop');

  $playerPositionBar = document.querySelector('.player .position .bar');

  $playerVolumeBar = document.querySelector('.player .volume .bar');

  $optionsSortForwards = document.querySelector('.option .forwards');

  $optionsSortBackwards = document.querySelector('.option .backwards');

  $filterWeek = document.querySelector('.sidebar .week');

  $filterMonth = document.querySelector('.sidebar .month');

  $filterAll = document.querySelector('.sidebar .all');

  $spinner = document.querySelector('.spinner');

  debounce = function(func, wait, immediate) {
    var timeout;
    timeout = null;
    return function() {
      var args, callNow, context, later;
      context = this;
      args = arguments;
      later = function() {
        timeout = null;
        if (!immediate) {
          return func.apply(context, args);
        }
      };
      callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) {
        return func.apply(context, args);
      }
    };
  };

  throttle = function(func, limit) {
    var inThrottle;
    inThrottle = null;
    return function() {
      var args, context;
      args = arguments;
      context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        return setTimeout(function() {
          return inThrottle = false;
        }, limit);
      }
    };
  };

  showSpinner = function() {
    return $spinner.style.display = 'block';
  };

  hideSpinner = function() {
    return $spinner.style.display = 'none';
  };

  updateDateFilter = function(_dateFilter) {
    var filterBtn, j, len, ref;
    ref = document.querySelectorAll('.sidebar .date-filter .button');
    for (j = 0, len = ref.length; j < len; j++) {
      filterBtn = ref[j];
      filterBtn.className = filterBtn.className.replace(/\s*selected/g, '');
    }
    if (_dateFilter) {
      dateFilter = _dateFilter;
    }
    switch (dateFilter) {
      case 'week':
        dateFrom = new Date().valueOf() - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        dateFrom = new Date().valueOf() - 31 * 24 * 60 * 60 * 1000;
        break;
      case 'all':
        dateFrom = 0;
    }
    return document.querySelector('.sidebar .date-filter .' + dateFilter).className += ' selected';
  };

  updateStatusFilter = function(_statusFilter) {
    var filterBtn, j, len, ref;
    ref = document.querySelectorAll('.sidebar .status-filter .button');
    for (j = 0, len = ref.length; j < len; j++) {
      filterBtn = ref[j];
      filterBtn.className = filterBtn.className.replace(/\s*selected/g, '');
    }
    if (_statusFilter) {
      statusFilter = _statusFilter;
    }
    return document.querySelector('.sidebar .status-filter .' + statusFilter).className += ' selected';
  };

  setPageState = function(state) {
    switch (state) {
      case 'search-results':
        $items.style.display = 'none';
        return $searchResults.style.display = 'flex';
      default:
        $items.style.display = 'flex';
        return $searchResults.style.display = 'none';
    }
  };

  setupAudio = function() {
    var analyser, audio, bf, el, source;
    el = document.querySelector('audio');
    audio = new AudioContext();
    source = audio.createMediaElementSource(el);
    bf = audio.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.setValueAtTime(20000, audio.currentTime);
    bf.gain.setValueAtTime(-20, audio.currentTime);
    analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    viz = require('./viz')(analyser);
    return source.connect(bf).connect(analyser).connect(audio.destination);
  };

  doReportListenStatus = function(context) {
    console.log('report listen status');
    return ipcRenderer.send(context + '-listen', {
      url: currentItem.url,
      pubDate: new Date(currentItem.pubDate).valueOf(),
      time: audioElm.currentTime,
      percent: audioElm.currentTime / audioElm.duration * 100,
      date: new Date().valueOf()
    });
  };

  reportListenStatus = throttle(doReportListenStatus, 30000);

  audioElm.ontimeupdate = function(e) {
    console.log('calling rls');
    reportListenStatus('app');
    return renderPlayer();
  };

  audioElm.onended = function(e) {
    doReportListenStatus('global');
    return next();
  };

  audioElm.onplay = function(e) {
    return renderPlayer();
  };

  audioElm.onpause = function(e) {
    doReportListenStatus('global');
    return renderPlayer();
  };

  formatDuration = function(duration) {
    var pad;
    if (!duration) {
      return '';
    }
    pad = function(num, length) {
      return (new Array(length).fill(0).join('') + num).slice(num.toString().length);
    };
    return duration.replace(/(.*?):(.*?):(.*)/, function(all, hours, mins) {
      return +hours + 'h' + pad(+mins, 2) + 'm';
    });
  };

  sanitize = function(text) {
    if (text) {
      return text.replace(/[^\d^\w]+/g, '');
    }
  };

  renderSidebar = function() {
    var j, len, podHTML, podcast, ref, ref1, ref2, ref3, ref4, ref5;
    podHTML = '';
    for (j = 0, len = podcasts.length; j < len; j++) {
      podcast = podcasts[j];
      if (currentFeed) {
        if (podcast.url === currentFeed) {
          podHTML = '<div class="pod-image" style="background-image:url(' + (((ref = podcast.itunes) != null ? ref.image : void 0) || ((ref1 = podcast.image) != null ? ref1.url : void 0) || ((ref2 = podcast.items[0].itunes) != null ? ref2.image : void 0)) + ')"></div><h2>' + podcast.title + '</h2><p>' + podcast.description + '</p>';
        }
      } else {
        podHTML += '<a onclick="renderer.showFeed(\'' + podcast.url + '\')" style="background-image:url(' + (((ref3 = podcast.itunes) != null ? ref3.image : void 0) || ((ref4 = podcast.image) != null ? ref4.url : void 0) || ((ref5 = podcast.items[0].itunes) != null ? ref5.image : void 0)) + ')"></a>';
      }
    }
    return document.querySelector('.sidebar .podcasts').innerHTML = podHTML;
  };

  renderItems = function() {
    var age, html, item, j, k, l, len, len1, len2, range, ref, ref1, ref2, ref3, ref4, ref5;
    html = '';
    for (j = 0, len = dateRanges.length; j < len; j++) {
      range = dateRanges[j];
      range.used = false;
    }
    for (k = 0, len1 = allItems.length; k < len1; k++) {
      item = allItems[k];
      age = new Date().valueOf() - new Date(item.pubDate).valueOf();
      for (l = 0, len2 = dateRanges.length; l < len2; l++) {
        range = dateRanges[l];
        if (age < range.time) {
          if (!range.used) {
            range.used = true;
            html += '<div class="date-range">' + range.name + '</div>';
          }
          break;
        }
      }
      html += '<div class="item ' + sanitize((ref = item.enclosure) != null ? ref.url : void 0) + '"><a onclick="renderer.play(\'' + ((ref1 = item.enclosure) != null ? ref1.url : void 0) + '\')"><div class="image" style="background-image: url(' + (((ref2 = item.itunes) != null ? ref2.image : void 0) || ((ref3 = item.feed.itunes) != null ? ref3.image : void 0) || ((ref4 = item.feed.image) != null ? ref4.url : void 0)) + ')" /></div><div class="details"><div class="fade"></div><div class="title">' + item.title + '</div><div class="pod-details"><div class="pod-title" onclick="renderer.showFeed(\'' + item.feed.url + '\', event)">' + item.feed.title + '</div><div class="date">' + dateFormat.format(new Date(item.pubDate)) + '</div></div><div class="summary">' + item.contentSnippet + '</div><div class="duration">' + formatDuration((ref5 = item.itunes) != null ? ref5.duration : void 0) + '</div></div></a></div>';
    }
    return document.querySelector('.items').innerHTML = html;
  };

  renderPodcasts = function(_podcasts) {
    var item, j, k, l, len, len1, len2, listen, podcast, ref, ref1, ref2;
    if (!((_podcasts || podcasts) && listens)) {
      return;
    }
    console.log('start');
    setPageState('items');
    allItems = [];
    ref = _podcasts || podcasts;
    for (j = 0, len = ref.length; j < len; j++) {
      podcast = ref[j];
      if (currentFeed && currentFeed !== podcast.url) {
        continue;
      }
      ref1 = podcast.items;
      for (k = 0, len1 = ref1.length; k < len1; k++) {
        item = ref1[k];
        item.feed = podcast;
        if ((ref2 = item.enclosure) != null ? ref2.url : void 0) {
          for (l = 0, len2 = listens.length; l < len2; l++) {
            listen = listens[l];
            if (listen.url === item.enclosure.url) {
              item.time = listen.time;
              item.percent = listen.percent;
              break;
            }
          }
        }
      }
      allItems = allItems.concat(podcast.items);
    }
    allItems = allItems.filter(function(item) {
      var ref3;
      if (currentItem && currentItem.url === item.url) {
        return true;
      }
      if ((dateFrom < (ref3 = new Date(item.pubDate).valueOf()) && ref3 < dateTo)) {
        if (item.percent && item.percent > 5) {
          item.listened = true;
          return statusFilter === 'listened' || statusFilter === 'all';
        } else {
          return statusFilter === 'unlistened' || statusFilter === 'all';
        }
      }
      return false;
    });
    allItems.sort(function(a, b) {
      if (new Date(a[sort]) > new Date(b[sort])) {
        return sortDir;
      } else {
        return sortDir * -1;
      }
    });
    renderItems();
    return setPlayState();
  };

  changeSort = async function() {
    sortDir = -sortDir;
    await renderPodcasts();
    return renderPlayer();
  };

  setDateFilter = async function(filter) {
    updateDateFilter(filter);
    await renderPodcasts();
    renderPlayer();
    return renderSidebar();
  };

  setStatusFilter = async function(filter) {
    updateStatusFilter(filter);
    await renderPodcasts();
    renderPlayer();
    return renderSidebar();
  };

  main = function() {
    setupAudio();
    ipcRenderer.send('get-user');
    ipcRenderer.on('user', function(win, _user) {
      user = _user;
      //ipcRenderer.send 'get-podcasts'
      return console.log('user', user);
    });
    ipcRenderer.on('podcast', function(win, _podcast) {
      return console.log('podcast', _podcast);
    });
    ipcRenderer.on('podcasts', function(win, data) {
      console.log(data);
      podcasts = data.podcasts;
      listens = data.listens;
      renderPodcasts(data.podcasts);
      updateDateFilter();
      updateStatusFilter();
      return renderSidebar();
    });
    ipcRenderer.on('listens', function(win, _listens) {
      listens = _listens;
      return renderPodcasts();
    });
    return setInterval(function() {
      return ipcRenderer.send('check-for-new');
    }, 10 * 1000);
  };

  main();

  fetchPodcast = function(url) {
    console.log('fetch pod', url);
    return new Promise(async function(resolve, reject) {
      var podcast, returned;
      returned = false;
      setTimeout(function() {
        if (!returned) {
          returned = true;
          return resolve(null);
        }
      }, 10000);
      try {
        podcast = (await parser.parseURL(url));
      } catch (error) {}
      if (!returned) {
        returned = true;
        return resolve(podcast);
      }
    });
  };

  fetchRssFeeds = async function(query, results) {
    var j, len, podcast, ref, ref1, ref2, result, results1;
    if (!results) {
      results = (await googleIt({
        query: query
      }));
    }
//podcasts = []
    results1 = [];
    for (j = 0, len = results.length; j < len; j++) {
      result = results[j];
      //if /xml(\W|$)/.test result.link
      podcast = null;
      try {
        podcast = (await fetchPodcast(result.link));
      } catch (error) {}
      if (podcast && podcast.items && podcast.items.length) {
        podcast.feedUrl = result.link;
        //podcasts.push podcast
        results1.push($searchResults.innerHTML += '<div class="item search-result"><div class="image" style="background-image: url(' + (((ref = podcast.itunes) != null ? ref.image : void 0) || ((ref1 = podcast.image) != null ? ref1.url : void 0) || ((ref2 = podcast.items[0].itunes) != null ? ref2.image : void 0)) + ')" /></div><div class="details"><div class="title">' + podcast.title + '</div><div class="timeago">' + twas(new Date(podcast.items[0].pubDate)) + '</div><a class="show-episodes" onclick="renderer.showPodcastEpisodes(event, \'' + podcast.feedUrl + '\')">Show episodes</a><a class="add-podcast" onclick="renderer.addPodcast(\'' + podcast.feedUrl + '\')">Add to my podcasts</a><div class="description">' + podcast.description + '</div></div></div>');
      } else {
        results1.push(void 0);
      }
    }
    return results1;
  };

  searchPodcasts = async function(e) {
    e.preventDefault();
    //show search results
    $searchResults.innerHTML = '';
    setPageState('search-results');
    showSpinner();
    //set to searching
    await fetchRssFeeds('', [
      {
        link: document.querySelector('#add-podcast').value
      }
    ]);
    await fetchRssFeeds(document.querySelector('#add-podcast').value + ' podcast rss');
    await fetchRssFeeds(document.querySelector('#add-podcast').value + ' podcast filetype:xml');
    //ipcRenderer.send 'add-podcast', document.querySelector('#add-podcast').value
    hideSpinner();
    return false;
  };

  addPodcast = function(url) {
    return ipcRenderer.send('add-podcast', url);
  };

  renderPlayer = function() {
    var ref;
    if (sortDir < 0) {
      $optionsSortForwards.style.display = 'block';
      $optionsSortBackwards.style.display = 'none';
    } else {
      $optionsSortForwards.style.display = 'none';
      $optionsSortBackwards.style.display = 'block';
    }
    if (currentItem && currentItem.feed) {
      $playerPodTitle.innerText = currentItem.title;
      $playerFeedTitle.innerText = currentItem.feed.title;
      $playerImage.style.backgroundImage = 'url(' + ((ref = currentItem.itunes) != null ? ref.image : void 0) + ')';
      if (audioElm.duration) {
        $playerPositionCurrent.innerText = duration(audioElm.currentTime, 's').format('h:mm:ss');
        $playerPositionDuration.innerText = duration(audioElm.duration, 's').format('h:mm:ss');
        $playerPositionBar.style.width = (audioElm.currentTime / audioElm.duration * 100) + '%';
      } else {
        $playerPositionCurrent.innerText = '';
        $playerPositionDuration.innerText = '';
        $playerPositionBar.style.width = '0%';
      }
      $playerVolumeBar.style.width = (audioElm.volume * 100) + '%';
      if (audioElm.paused) {
        $playerPlay.style.display = 'block';
        $playerStop.style.display = 'none';
      } else {
        $playerPlay.style.display = 'none';
        $playerStop.style.display = 'block';
      }
      if (currentItem.prev) {
        $playerPrev.style.visibility = 'visible';
      } else {
        $playerPrev.style.visibility = 'hidden';
      }
      if (currentItem.next) {
        return $playerNext.style.visibility = 'visible';
      } else {
        return $playerNext.style.visibility = 'hidden';
      }
    }
  };

  clearPlayState = function(elm) {
    if (elm) {
      return elm.className = elm.className.replace(/\s*playing|\s*paused/g, '');
    }
  };

  setPlayState = function() {
    if (currentItem) {
      if (currentElm) {
        clearPlayState(currentElm);
      }
      currentElm = document.querySelector('.' + sanitize(currentItem.url));
      if (currentElm) {
        clearPlayState(currentElm);
        currentElm.className += ' playing';
        return currentElm.scrollIntoViewIfNeeded();
      }
    }
  };

  play = function(url) {
    var i, item, j, len, ref, ref1, ref2;
    if (url) {
      if ((currentItem != null ? currentItem.url : void 0) === url && !audioElm.paused) {
        return stop();
      }
      if ((currentItem != null ? currentItem.url : void 0) !== url) {
        for (i = j = 0, len = allItems.length; j < len; i = ++j) {
          item = allItems[i];
          if (((ref = item.enclosure) != null ? ref.url : void 0) === url) {
            currentItem = item;
            currentItem.url = url;
            currentItem.reported = false;
            currentItem.prev = allItems[i - 1];
            currentItem.next = allItems[i + 1];
            audioElm.src = url;
            if (item.time) {
              audioElm.currentTime = item.time;
            }
            break;
          }
        }
      }
    }
    if (currentItem) {
      clearPlayState(currentElm);
      setPlayState();
      audioElm.volume = 0.1;
      audioElm.play();
      return $player.style.display = 'flex';
    } else {
      return play((ref1 = allItems[0]) != null ? (ref2 = ref1.enclosure) != null ? ref2.url : void 0 : void 0);
    }
  };

  stop = function() {
    if (currentItem) {
      clearPlayState(currentElm);
      currentElm.className += ' paused';
      return audioElm.pause();
    }
  };

  setVolume = function(e) {
    audioElm.volume = e.layerX / e.srcElement.offsetWidth;
    return renderPlayer();
  };

  setPosition = function(e) {
    return audioElm.currentTime = e.layerX / e.srcElement.offsetWidth * audioElm.duration;
  };

  prev = function() {
    var ref, ref1;
    if (audioElm.currentTime > 5) {
      return play(currentItem.url);
    }
    if (currentItem != null ? currentItem.prev : void 0) {
      return play((ref = currentItem.prev) != null ? (ref1 = ref.enclosure) != null ? ref1.url : void 0 : void 0);
    }
  };

  next = function() {
    var ref, ref1;
    if (currentItem != null ? currentItem.next : void 0) {
      return play((ref = currentItem.next) != null ? (ref1 = ref.enclosure) != null ? ref1.url : void 0 : void 0);
    }
  };

  showPodcastEpisodes = function(event, feedUrl) {
    var j, len, podcast;
    event.stopPropagation();
    console.log('show pod episodes', feedUrl);
    for (j = 0, len = podcasts.length; j < len; j++) {
      podcast = podcasts[j];
      if (podcast.feedUrl === feedUrl) {
        console.log('got podcast');
        return renderPodcasts([podcast]);
      }
    }
  };

  showFeed = function(url, event) {
    if (event) {
      event.stopPropagation();
    }
    currentFeed = url;
    setPageState('feed');
    sort = 'pubDate';
    sortDir = -1;
    return setDateFilter('all');
  };

  showSubscriptions = function() {
    currentFeed = null;
    setPageState('subscriptions');
    sort = 'pubDate';
    sortDir = -1;
    return setDateFilter('week');
  };

  getChannel = function() {
    return ipcRenderer.send('get-channel');
  };

  joinChannel = function() {
    return ipcRenderer.send('join-channel');
  };

  draw = function() {
    requestAnimationFrame(draw);
    if (viz) {
      return viz.draw();
    }
  };

  draw();

  module.exports = {
    addPodcast: addPodcast,
    searchPodcasts: searchPodcasts,
    play: play,
    stop: stop,
    setVolume: setVolume,
    setPosition: setPosition,
    prev: prev,
    next: next,
    showPodcastEpisodes: showPodcastEpisodes,
    changeSort: changeSort,
    setDateFilter: setDateFilter,
    setStatusFilter: setStatusFilter,
    showFeed: showFeed,
    showSubscriptions: showSubscriptions,
    getChannel: getChannel,
    joinChannel: joinChannel
  };

}).call(this);

//# sourceMappingURL=renderer.js.map
