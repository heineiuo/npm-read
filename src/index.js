/**
 * Copyright (c) 2018-present, heineiuo.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import stream from 'stream'
import fetch from 'node-fetch'
import tar from 'tar'
import semver from 'semver'
import errors from 'http-errors'

const __DEV__ = process.env.NODE_ENV === 'development'

async function getDownloadDir (name, exactVersion) {
  const folder = path.resolve(os.homedir(), '.npm-readfile/files', name, exactVersion)
  try {
    await fs.promises.stat(folder)
    return folder
  } catch (e) {
    if (e.code === 'ENOENT') {
      try {
        await fs.promises.mkdir(folder, { recursive: true })
        return folder
      } catch (e) {
        throw e
      }
    } else {
      throw e
    }
  }
}

async function getPkgFilePath (name) {
  const folder = path.resolve(os.homedir(), '.npm-readfile/pkgs', name)
  try {
    await fs.promises.stat(folder)
    return path.resolve(folder, 'index.json')
  } catch (e) {
    // console.log(e)
    if (e.code === 'ENOENT') {
      try {
        await fs.promises.mkdir(folder, { recursive: true })
        return path.resolve(folder, 'index.json')
      } catch (e) {
        throw e
      }
    } else {
      throw e
    }
  }
}

function registryUrl (registry = 'https://registry.npmjs.org/') {
  return registry.slice(-1) === '/' ? registry : registry + '/'
}

function downloadAndExtract (dir, address) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(address)
      const buf = await res.buffer()
      const bufferStream = new stream.PassThrough()
      bufferStream.end(buf)
      bufferStream.pipe(
        tar.x({
          strip: 1,
          C: dir
        })
      )
      bufferStream.on('error', (e) => {
        reject(e)
      })
      bufferStream.on('end', () => {
        resolve()
      })
    } catch (e) {
      reject(e)
    }
  })
}

function parseAddress (address) {
  if (__DEV__) console.log(`address: ${address}`)
  const { pathname, origin } = new URL(address)

  if (__DEV__) console.log(`origin: ${origin}`)
  if (__DEV__) console.log(`pathname: ${pathname}`)
  const pathList = pathname.split('/').filter(item => !!item)
  if (pathList.length < 2) throw new errors.BadRequest()
  let nameWithVersion = pathList.shift()
  if (nameWithVersion[0] === '@') nameWithVersion += `/${pathList.shift()}`
  const atList = nameWithVersion.split('@')
  let [name, version] = atList.length === 3 ? [`@${atList[1]}`, atList[2]] : atList
  const pkgUrl = `${registryUrl()}${encodeURIComponent(name).replace(/^%40/, '@')}`
  const filePath = pathList.join('/')

  if (__DEV__) console.log(`name: ${name}`)
  if (__DEV__) console.log(`version: ${version}`)
  if (__DEV__) console.log(`pkgUrl: ${pkgUrl}`)
  if (__DEV__) console.log(`filePath: ${filePath}`)

  return { name, version, pkgUrl, filePath }
}

async function getPkgData (name, pkgUrl, expire = 30000) {
  const pkgFilePath = await getPkgFilePath(name)
  let data = null
  let shouldUpdate = true
  try {
    const stat = await fs.promises.stat(pkgFilePath)
    if (Date.now() < stat.mtime.getTime() + expire) {
      shouldUpdate = false
    }
  } catch (e) {
    // console.log(e)
  }
  if (shouldUpdate) {
    if (__DEV__) console.log('fetching pkg json from registry')
    const res = await fetch(pkgUrl, {
      headers: {
        accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'
      }
    })

    data = await res.json()
    await fs.promises.writeFile(pkgFilePath, JSON.stringify(data), 'utf8')
  } else {
    if (__DEV__) console.log('read pkg file from local')
    data = JSON.parse(await fs.promises.readFile(pkgFilePath, 'utf8'))
  }
  return data
}

async function fetchPkgData (name, pkgUrl, version) {
  let data = await getPkgData(name, pkgUrl)
  if (!data) throw new errors.NotFound()

  let isDistTag = false

  if (data['dist-tags'][version]) {
    isDistTag = true
    version = data['dist-tags'][version]
    data = data.versions[version]
  } else if (version) {
    if (!data.versions[version]) {
      const versions = Object.keys(data.versions)
      version = semver.maxSatisfying(versions, version)

      if (!version) {
        throw new Error('Version doesn\'t exist')
      }
    }

    data = data.versions[version]

    if (!data) {
      throw new Error('Version doesn\'t exist')
    }
  }

  return {
    isDistTag,
    data,
    exactVersion: version
  }
}

export async function downloadFile (address) {
  if (!address) throw new errors.BadRequest()

  let {
    name,
    version,
    pkgUrl,
    filePath
  } = parseAddress(address)

  if (semver.valid(version)) {
    if (__DEV__) console.log('is exactly version, try to load local cache')
    try {
      let dlDir = await getDownloadDir(name, version)
      const fullFilePath = path.join(dlDir, filePath)
      if (!(fullFilePath.indexOf(dlDir) === 0)) throw new errors.Forbidden()
      await fs.promises.stat(fullFilePath)
      return fullFilePath
    } catch (e) {
    }
  }

  let {
    exactVersion,
    data
    // isDistTag
  } = await fetchPkgData(name, pkgUrl, version)
  let dlDir = await getDownloadDir(name, exactVersion)

  await downloadAndExtract(dlDir, data.dist.tarball)
  const fullFilePath = path.join(dlDir, filePath)
  if (!(fullFilePath.indexOf(dlDir) === 0)) throw new errors.Forbidden()
  return fullFilePath
}

export async function readFile (address, options) {
  const fullFilePath = await downloadFile(address)
  const result = await fs.promises.readFile(fullFilePath, options)
  return result
}
