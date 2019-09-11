(function() {
  var ipcRenderer;

  ({ipcRenderer} = require('electron'));

  module.exports = {
    submit: function(event) {
      event.stopPropagation();
      return ipcRenderer.send('set-channel-id', document.querySelector('.channelID').value);
    }
  };

}).call(this);

//# sourceMappingURL=join-channel.js.map
