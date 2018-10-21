const npm = require('../dist')

async function main () {
  // console.time('@babel/core@latest')
  // const content = await npm.readFile('https://registry.npmjs.org/@babel/core@latest/lib/index.js', 'utf8')
  // console.log(`content: ${content.substr(0, 100).replace(/\n\r?/g, '\\n')}...`)
  // console.timeEnd('@babel/core@latest')

  console.time('@babel/core@7.1.2')
  const content2 = await npm.readFile('https://registry.npmjs.org/@babel/core@7.1.2/lib/index.js', 'utf8')
  console.log(`content: ${content2.substr(0, 100).replace(/\n\r?/g, '\\n')}...`)
  console.timeEnd('@babel/core@7.1.2')
}

main()
