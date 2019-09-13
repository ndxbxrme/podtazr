{ipcRenderer} = require 'electron'
googleIt = require 'google-it'
DateFormat = require 'fast-date-format'
dateFormat = new DateFormat 'hA, ddd DD MMM YYYY'
duration = require('format-duration-time').default
Parser = require 'rss-parser'
parser = new Parser()
twas = require 'twas'
viz = null
user = null
audioElm = document.querySelector 'audio'
currentItem = null
currentElm = null
currentFeed = null
autoplay = true
dateFilter = 'week'
statusFilter = 'unlistened'
dateFrom = new Date().valueOf() - 7 * 24 * 60 * 60 * 1000
dateTo = Number.MAX_SAFE_INTEGER
sort = 'pubDate'
allItems = []
podcasts = []
listens = null
sortDir = -1
dateRanges = [
  time: 24 * 60 * 60 * 1000
  name: 'Today'
,
  time: 48 * 60 * 60 * 1000
  name: 'Yesterday'
,
  time: 7 * 24 * 60 * 60 * 1000
  name: 'This week'
,
  time: 14 * 24 * 60 * 60 * 1000
  name: 'Last week'
,
  time: 31 * 24 * 60 * 60 * 1000
  name: 'This month'
,
  time: 62 * 24 * 60 * 60 * 1000
  name: 'Last month'
,
  time: Number.MAX_SAFE_INTEGER
  name: 'Older'
]
$items = document.querySelector('.items')
$searchResults = document.querySelector('.search-results')
$player = document.querySelector('.player')
$playerPodTitle = document.querySelector('.player .pod .title')
$playerFeedTitle = document.querySelector('.player .pod .feed-title')
$playerImage = document.querySelector('.player .pod-image')
$playerPositionCurrent = document.querySelector('.player .position .current')
$playerPositionDuration = document.querySelector('.player .position .duration')
$playerPrev = document.querySelector('.player .prev')
$playerNext = document.querySelector('.player .next')
$playerPlay = document.querySelector('.player .play')
$playerStop = document.querySelector('.player .stop')
$playerPositionBar = document.querySelector('.player .position .bar')
$playerVolumeBar = document.querySelector('.player .volume .bar')
$optionsSortForwards = document.querySelector('.option .forwards')
$optionsSortBackwards = document.querySelector('.option .backwards')
$filterWeek = document.querySelector('.sidebar .week')
$filterMonth = document.querySelector('.sidebar .month')
$filterAll = document.querySelector('.sidebar .all')
$spinner = document.querySelector('.spinner')

debounce = (func, wait, immediate) ->
  timeout = null
  ->
    context = @
    args = arguments
    later = ->
      timeout = null
      func.apply(context, args) if not immediate
    callNow = immediate and not timeout
    clearTimeout timeout
    timeout = setTimeout later, wait
    func.apply(context, args) if callNow
    
throttle = (func, limit) ->
  inThrottle = null
  () ->
    args = arguments
    context = @
    if not inThrottle
      func.apply context, args
      inThrottle = true
      setTimeout ->
        inThrottle = false
      , limit
      
showSpinner = ->
  $spinner.style.display = 'block'
hideSpinner = ->
  $spinner.style.display = 'none'

updateDateFilter = (_dateFilter) ->
  for filterBtn in document.querySelectorAll('.sidebar .date-filter .button')
    filterBtn.className = filterBtn.className.replace /\s*selected/g, ''
  dateFilter = _dateFilter if _dateFilter
  switch dateFilter
    when 'week'
      dateFrom = new Date().valueOf() - 7 * 24 * 60 * 60 * 1000
    when 'month'
      dateFrom = new Date().valueOf() - 31 * 24 * 60 * 60 * 1000
    when 'all'
      dateFrom = 0
  document.querySelector('.sidebar .date-filter .' + dateFilter).className += ' selected'
updateStatusFilter = (_statusFilter) ->
  for filterBtn in document.querySelectorAll('.sidebar .status-filter .button')
    filterBtn.className = filterBtn.className.replace /\s*selected/g, ''
  statusFilter = _statusFilter if _statusFilter
  document.querySelector('.sidebar .status-filter .' + statusFilter).className += ' selected'
setPageState = (state) ->
  switch state
    when 'search-results'
      $items.style.display = 'none'
      $searchResults.style.display = 'flex'
    else
      $items.style.display = 'flex'
      $searchResults.style.display = 'none'

setupAudio = ->
  el = document.querySelector 'audio'
  audio = new AudioContext()
  source = audio.createMediaElementSource el
  bf = audio.createBiquadFilter()
  bf.type = 'lowpass'
  bf.frequency.setValueAtTime 20000, audio.currentTime
  bf.gain.setValueAtTime -20, audio.currentTime
  analyser = audio.createAnalyser()
  analyser.fftSize = 2048
  viz = require('./viz') analyser
  source.connect bf
  .connect analyser
  .connect audio.destination
  
doReportListenStatus = (context) ->
  console.log 'report listen status'
  ipcRenderer.send context + '-listen',
    url: currentItem.url
    pubDate: new Date(currentItem.pubDate).valueOf()
    time: audioElm.currentTime
    percent: audioElm.currentTime / audioElm.duration * 100
    date: new Date().valueOf()
  
reportListenStatus = throttle doReportListenStatus, 30000

audioElm.ontimeupdate = (e) ->
  console.log 'calling rls'
  reportListenStatus 'app'
  renderPlayer()

audioElm.onended = (e) ->
  doReportListenStatus 'global'
  next()

audioElm.onplay = (e) ->
  renderPlayer()

audioElm.onpause = (e) ->
  doReportListenStatus 'global'
  renderPlayer()

formatDuration = (duration) ->
  return '' if not duration
  pad = (num,length) ->
    (new Array(length).fill(0).join('') + num).slice(num.toString().length)
  duration.replace /(.*?):(.*?):(.*)/, (all, hours, mins) ->
    +hours + 'h' + pad(+mins, 2) + 'm'
    
sanitize = (text) ->
  text.replace /[^\d^\w]+/g, '' if text
  
renderSidebar = ->
  podHTML = ''
  for podcast in podcasts
    if currentFeed
      if podcast.url is currentFeed
        podHTML = '<div class="pod-image" style="background-image:url(' + (podcast.itunes?.image or podcast.image?.url or podcast.items[0].itunes?.image) + ')"></div><h2>' + podcast.title + '</h2><p>' + podcast.description + '</p>'
    else
      podHTML += '<a onclick="renderer.showFeed(\'' + podcast.url + '\')" style="background-image:url(' + (podcast.itunes?.image or podcast.image?.url or podcast.items[0].itunes?.image) + ')"></a>'
  document.querySelector('.sidebar .podcasts').innerHTML = podHTML
renderItems = ->
  html = ''
  for range in dateRanges
    range.used = false
  for item in allItems
    age = new Date().valueOf() - new Date(item.pubDate).valueOf()
    for range in dateRanges
      if age < range.time
        if not range.used
          range.used = true
          html += '<div class="date-range">' + range.name + '</div>'
        break
    html += '<div class="item ' + sanitize(item.enclosure?.url) + '"><a onclick="renderer.play(\'' + item.enclosure?.url + '\')"><div class="image" style="background-image: url(' + (item.itunes?.image or item.feed.itunes?.image or item.feed.image?.url) + ')" /></div><div class="details"><div class="fade"></div><div class="title">' + item.title + '</div><div class="pod-details"><div class="pod-title" onclick="renderer.showFeed(\'' + item.feed.url + '\', event)">' + item.feed.title + '</div><div class="date">' + dateFormat.format(new Date(item.pubDate)) + '</div></div><div class="summary">' + item.contentSnippet + '</div><div class="duration">' + formatDuration(item.itunes?.duration) + '</div></div></a></div>'
  document.querySelector('.items').innerHTML = html
  
renderPodcasts = (_podcasts) ->
  return if not ((_podcasts or podcasts) and listens)
  console.log 'start'
  setPageState 'items'
  allItems = []
  for podcast in (_podcasts or podcasts)
    continue if currentFeed and currentFeed isnt podcast.url
    for item in podcast.items
      item.feed = podcast
      if item.enclosure?.url
        for listen in listens
          if listen.url is item.enclosure.url
            item.time = listen.time
            item.percent = listen.percent
            break
    allItems = allItems.concat podcast.items
  allItems = allItems.filter (item) ->
    return true if currentItem and currentItem.url is item.url
    if dateFrom < new Date(item.pubDate).valueOf() < dateTo
      if item.percent and item.percent > 5
        item.listened = true
        return statusFilter is 'listened' or statusFilter is 'all'
      else
        return statusFilter is 'unlistened' or statusFilter is 'all'
    false
  allItems.sort (a, b) ->
    if new Date(a[sort]) > new Date(b[sort]) then sortDir else sortDir * -1
  renderItems()
  setPlayState()
  
changeSort = ->
  sortDir = -sortDir
  await renderPodcasts()
  renderPlayer()
  
setDateFilter = (filter) ->
  updateDateFilter filter
  await renderPodcasts()
  renderPlayer()
  renderSidebar()
  
setStatusFilter = (filter) ->
  updateStatusFilter filter
  await renderPodcasts()
  renderPlayer()
  renderSidebar()
  

main = ->
  setupAudio()
  ipcRenderer.send 'get-user'
  ipcRenderer.on 'user', (win, _user) ->
    user = _user
    #ipcRenderer.send 'get-podcasts'
    console.log 'user', user
  ipcRenderer.on 'podcast', (win, _podcast) ->
    console.log 'podcast', _podcast
  ipcRenderer.on 'podcasts', (win, data) ->
    console.log data
    podcasts = data.podcasts
    listens = data.listens
    renderPodcasts data.podcasts
    updateDateFilter()
    updateStatusFilter()
    renderSidebar()
  ipcRenderer.on 'listens', (win, _listens) ->
    listens = _listens
    renderPodcasts()
  setInterval ->
    ipcRenderer.send 'check-for-new'
  , 10 * 1000
main()

fetchPodcast = (url) ->
  console.log 'fetch pod', url
  new Promise (resolve, reject) ->
    returned = false
    setTimeout ->
      if not returned
        returned = true
        resolve null
    , 10000
    try
      podcast = await parser.parseURL url
    if not returned
      returned = true
      resolve podcast

fetchRssFeeds = (query, results) ->
  if not results
    results = await googleIt
      query: query
  #podcasts = []
  for result in results
    #if /xml(\W|$)/.test result.link
    podcast = null
    try
      podcast = await fetchPodcast result.link
    if podcast and podcast.items and podcast.items.length
      podcast.feedUrl = result.link
      #podcasts.push podcast
      $searchResults.innerHTML += '<div class="item search-result"><div class="image" style="background-image: url(' + (podcast.itunes?.image or podcast.image?.url or podcast.items[0].itunes?.image) + ')" /></div><div class="details"><div class="title">' + podcast.title + '</div><div class="timeago">' + twas(new Date(podcast.items[0].pubDate)) + '</div><a class="show-episodes" onclick="renderer.showPodcastEpisodes(event, \'' + podcast.feedUrl + '\')">Show episodes</a><a class="add-podcast" onclick="renderer.addPodcast(\'' + podcast.feedUrl + '\')">Add to my podcasts</a><div class="description">' + podcast.description + '</div></div></div>'

searchPodcasts = (e) ->
  e.preventDefault()
  #show search results
  $searchResults.innerHTML = ''
  setPageState 'search-results'
  showSpinner()
  #set to searching
  await fetchRssFeeds '', [link:document.querySelector('#add-podcast').value]
  await fetchRssFeeds document.querySelector('#add-podcast').value + ' podcast rss'
  await fetchRssFeeds document.querySelector('#add-podcast').value + ' podcast filetype:xml'
  #ipcRenderer.send 'add-podcast', document.querySelector('#add-podcast').value
  hideSpinner()
  return false
  
addPodcast = (url) ->
  ipcRenderer.send 'add-podcast', url
  
renderPlayer = ->
  if sortDir < 0
    $optionsSortForwards.style.display = 'block'
    $optionsSortBackwards.style.display = 'none'
  else
    $optionsSortForwards.style.display = 'none'
    $optionsSortBackwards.style.display = 'block'
  if currentItem and currentItem.feed
    $playerPodTitle.innerText = currentItem.title
    $playerFeedTitle.innerText = currentItem.feed.title
    $playerImage.style.backgroundImage = 'url(' + currentItem.itunes?.image + ')'
    if audioElm.duration
      $playerPositionCurrent.innerText = duration(audioElm.currentTime, 's').format('h:mm:ss')
      $playerPositionDuration.innerText = duration(audioElm.duration, 's').format('h:mm:ss')
      $playerPositionBar.style.width = (audioElm.currentTime / audioElm.duration * 100) + '%'
    else
      $playerPositionCurrent.innerText = ''
      $playerPositionDuration.innerText = ''
      $playerPositionBar.style.width = '0%'
    $playerVolumeBar.style.width = (audioElm.volume * 100) + '%'
    if audioElm.paused
      $playerPlay.style.display = 'block'
      $playerStop.style.display = 'none'
    else
      $playerPlay.style.display = 'none'
      $playerStop.style.display = 'block'
    if currentItem.prev
      $playerPrev.style.visibility = 'visible'
    else
      $playerPrev.style.visibility = 'hidden'
    if currentItem.next
      $playerNext.style.visibility = 'visible'
    else
      $playerNext.style.visibility = 'hidden'
      
clearPlayState = (elm) ->
  elm.className = elm.className.replace /\s*playing|\s*paused/g, '' if elm
setPlayState = ->
  if currentItem
    clearPlayState currentElm if currentElm
    currentElm = document.querySelector '.' + sanitize(currentItem.url)
    if currentElm
      clearPlayState currentElm
      currentElm.className += ' playing'
      currentElm.scrollIntoViewIfNeeded()

play = (url) ->
  if url
    if currentItem?.url is url and not audioElm.paused
      return stop()
    if currentItem?.url isnt url
      for item, i in allItems
        if item.enclosure?.url is url
          currentItem = item
          currentItem.url = url
          currentItem.reported = false
          currentItem.prev = allItems[i - 1]
          currentItem.next = allItems[i + 1]
          audioElm.src = url
          if item.time
            audioElm.currentTime = item.time
          break
  if currentItem
    clearPlayState currentElm
    setPlayState()
    audioElm.volume = 0.1
    audioElm.play()
    $player.style.display = 'flex'
  else
    play allItems[0]?.enclosure?.url
stop = ->
  if currentItem
    clearPlayState currentElm
    currentElm.className += ' paused'
    audioElm.pause()
    
setVolume = (e) ->
  audioElm.volume = e.layerX / e.srcElement.offsetWidth
  renderPlayer()

setPosition = (e) ->
  audioElm.currentTime = e.layerX / e.srcElement.offsetWidth * audioElm.duration
  
prev = ->
  if audioElm.currentTime > 5
    return play currentItem.url
  play currentItem.prev?.enclosure?.url if currentItem?.prev
next = ->
  play currentItem.next?.enclosure?.url if currentItem?.next
  
showPodcastEpisodes = (event, feedUrl) ->
  event.stopPropagation()
  console.log 'show pod episodes', feedUrl
  for podcast in podcasts
    if podcast.feedUrl is feedUrl
      console.log 'got podcast'
      return renderPodcasts [podcast]
      
showFeed = (url, event) ->
  event.stopPropagation() if event
  currentFeed = url
  setPageState 'feed'
  sort = 'pubDate'
  sortDir = -1
  setDateFilter 'all'
  
showSubscriptions = ->
  currentFeed = null
  setPageState 'subscriptions'
  sort = 'pubDate'
  sortDir = -1
  setDateFilter 'week'
  
getChannel = ->
  ipcRenderer.send 'get-channel'
  
joinChannel = ->
  ipcRenderer.send 'join-channel'
      
draw = ->
  requestAnimationFrame draw
  viz.draw() if viz
draw()
  
module.exports =
  addPodcast: addPodcast
  searchPodcasts: searchPodcasts
  play: play
  stop: stop
  setVolume: setVolume
  setPosition: setPosition
  prev: prev
  next: next
  showPodcastEpisodes: showPodcastEpisodes
  changeSort: changeSort
  setDateFilter: setDateFilter
  setStatusFilter: setStatusFilter
  showFeed: showFeed
  showSubscriptions: showSubscriptions
  getChannel: getChannel
  joinChannel: joinChannel