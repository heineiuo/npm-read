const stream = require('stream')

function createReadStream () {
  const pass = new stream.PassThrough()
  let count = 10
  let timer = setInterval(function () {
    if (count === 0) {
      clearInterval(timer)
      return pass.end()
    }
    pass.write(`\r${count}   `)
    count--
  }, 1000)
  return pass
}

function main () {
  const rs = createReadStream()
  rs.pipe(process.stdout)
  rs.on('error', console.log)
  rs.on('end', () => console.log('\rBoom!!!'))
}

main()
