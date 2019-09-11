(function() {
  var ipcRenderer;

  ({ipcRenderer} = require('electron'));

  ipcRenderer.on('channel-id', function(win, data) {
    return document.querySelector('.channelID').innerText = data;
  });

  module.exports = {};

}).call(this);

//# sourceMappingURL=get-channel.js.map
