{ipcRenderer} = require 'electron'

ipcRenderer.on 'channel-id', (win, data) ->
  document.querySelector('.channelID').innerText = data

module.exports = {}