const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const width = 640
const height = 360
const source = join(__dirname, '..', 'assets', 'portable-splash.svg')
const destination = join(__dirname, '..', 'assets', 'portable-splash.bmp')

function encodeBmp(bitmap) {
  const rowSize = Math.ceil(width * 3 / 4) * 4
  const pixelsSize = rowSize * height
  const headerSize = 14 + 40
  const output = Buffer.alloc(headerSize + pixelsSize)

  output.write('BM', 0, 'ascii')
  output.writeUInt32LE(output.length, 2)
  output.writeUInt32LE(headerSize, 10)
  output.writeUInt32LE(40, 14)
  output.writeInt32LE(width, 18)
  output.writeInt32LE(height, 22)
  output.writeUInt16LE(1, 26)
  output.writeUInt16LE(24, 28)
  output.writeUInt32LE(0, 30)
  output.writeUInt32LE(pixelsSize, 34)
  output.writeInt32LE(3_780, 38)
  output.writeInt32LE(3_780, 42)

  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * width * 4
    const destinationRow = headerSize + (height - y - 1) * rowSize
    for (let x = 0; x < width; x += 1) {
      const sourcePixel = sourceRow + x * 4
      const destinationPixel = destinationRow + x * 3
      output[destinationPixel] = bitmap[sourcePixel]
      output[destinationPixel + 1] = bitmap[sourcePixel + 1]
      output[destinationPixel + 2] = bitmap[sourcePixel + 2]
    }
  }
  return output
}

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  await window.loadFile(source)
  const image = await window.webContents.capturePage({ x: 0, y: 0, width, height })
  if (image.getSize().width !== width || image.getSize().height !== height) {
    throw new Error(`unexpected splash size: ${JSON.stringify(image.getSize())}`)
  }
  writeFileSync(destination, encodeBmp(image.toBitmap()))
  window.destroy()
  app.quit()
}).catch(error => {
  process.stderr.write(`${error.stack ?? String(error)}\n`)
  app.exit(1)
})
