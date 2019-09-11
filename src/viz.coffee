module.exports = (analyser) ->
  analyser.fftSize = 2048
  bufferLength = analyser.frequencyBinCount
  dataArray = new Uint8Array bufferLength
  canvas = document.querySelector 'canvas'
  canvasCtx = canvas.getContext '2d'
  draw: ->
    analyser.getByteTimeDomainData dataArray
    canvasCtx.fillStyle = 'rgb(0, 0, 0)'
    canvasCtx.fillRect 0, 0, canvas.width, canvas.height
    canvasCtx.lineWidth = 2
    canvasCtx.strokeStyle = 'rgb(0, 255, 0)'
    canvasCtx.beginPath()
    sliceWidth = canvas.width * 1.0 / bufferLength
    x = 0
    i = -1
    while i++ < bufferLength
      v = dataArray[i] / 128.0
      y = v * canvas.height / 2
      if i is 0
        canvasCtx.moveTo x, y
      else
        canvasCtx.lineTo x, y
      x += sliceWidth
    canvasCtx.lineTo canvas.width, canvas.height / 2
    canvasCtx.stroke()