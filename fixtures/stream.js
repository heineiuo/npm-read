const npm = require('../dist')

async function main () {
  console.time('@babel/core@7.1.2')
  const rs = await npm.createReadStream(
    'https://registry.npmjs.org/@babel/core@latest/lib/index.js',
    {
      encoding: 'utf8',
      preferCache: true
    }
  )
  rs.pipe(process.stdout)
  rs.on('error', console.log)
  rs.on('end', () => {
    process.exit(0)
  })
}

main()
