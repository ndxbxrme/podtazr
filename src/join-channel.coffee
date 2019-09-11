{ipcRenderer} = require 'electron'

module.exports =
  submit: (event) ->
    event.stopPropagation()
    ipcRenderer.send 'set-channel-id', document.querySelector('.channelID').value
    