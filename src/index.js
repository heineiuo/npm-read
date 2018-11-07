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
import tar from 'tar-stream'
import semver from 'semver'
import errors from 'http-errors'
import gunzip from 'gunzip-maybe'

const __DEV__ = process.env.NODE_ENV === 'development'

function getDownloadDir (name, exactVersion) {
  const folder = path.resolve(os.homedir(), '.npm-read', 'files', name, exactVersion)
  return folder
}

function getPkgFilePath (name) {
  const file = path.resolve(os.homedir(), '.npm-read', 'index', name, 'index.json')
  return file
}

async function ensureFolder (folder) {
  try {
    await fs.promises.access(folder, fs.constants.W_OK)
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

function registryUrl (registry = 'https://registry.npmjs.org/') {
  return registry.slice(-1) === '/' ? registry : registry + '/'
}

function getFullFilePath (dlDir, filePath) {
  const fullFilePath = path.join(dlDir, filePath)
  if (!(fullFilePath.indexOf(dlDir) === 0)) throw new errors.Forbidden()
  return fullFilePath
}

function downloadAndExtract (address, dir) {
  if (__DEV__) console.log(`\n Downloading ${address} \n `)
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(address)
      const buf = await res.buffer()
      const bufferStream = new stream.PassThrough()
      const extract = tar.extract()
      extract.on('entry', async function (header, stream, next) {
        const withoutPrefix = header.name.indexOf('package') === 0 ? header.name.substr(7) : header.name
        const writePath = path.join(dir, withoutPrefix)
        const folder = header.type === 'file' ? path.dirname(writePath) : writePath
        await ensureFolder(folder)
        if (header.type === 'file') {
          const ws = fs.createWriteStream(writePath)
          stream.pipe(ws)
        }
        stream.on('end', function () {
          next()
        })
        stream.resume()
      })
      extract.on('finish', function () {
        resolve()
      })
      bufferStream.pipe(gunzip()).pipe(extract)
      bufferStream.end(buf)
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

async function readCachedPkgIndexData (name) {
  try {
    const pkgFilePath = getPkgFilePath(name)
    const stat = await fs.promises.stat(pkgFilePath)
    const data = JSON.parse(await fs.promises.readFile(pkgFilePath, 'utf8'))
    return {
      data,
      mtime: stat.mtime.getTime()
    }
  } catch (e) {
    return {
      data: null
    }
  }
}

/**
 * fetch all data of a package
 * @param {string} name
 * @param {string} pkgUrl
 * @param {string} expire
 */
async function fetchPkgIndexData (name, pkgUrl, expire = 30000) {
  const pkgFilePath = getPkgFilePath(name)
  let { data, mtime } = await readCachedPkgIndexData(name)
  if (!data || Date.now() > mtime + expire) {
    if (__DEV__) console.log('fetching pkg json from registry')
    const res = await fetch(pkgUrl, {
      headers: {
        accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'
      }
    })
    data = await res.json()
    await ensureFolder(path.dirname(pkgFilePath))
    await fs.promises.writeFile(pkgFilePath, JSON.stringify(data), 'utf8')
  }
  return data
}

/**
 * fetch data of a exact version package
 * @param {string} name
 * @param {string} pkgUrl
 * @param {string} version
 * @returns {object} data
 * data {
 *   isDistTag,
 *   data,
 *   exactVersion: version
 * }
 */
async function fetchPkgData (name, pkgUrl, version) {
  let data = await fetchPkgIndexData(name, pkgUrl)
  if (!data) throw new errors.NotFound()
  if (data.error) {
    if (data.error === 'Not Found') throw new errors.NotFound()
    throw new errors.BadRequest(data.error)
  }

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

function getExactVersion (data, rawVersion) {
  if (!rawVersion) throw new errors.BadRequest('Version doesn\'t exist')
  let version = rawVersion
  if (data['dist-tags'][version]) {
    return data['dist-tags'][version]
  } else if (!data.versions[version]) {
    const versions = Object.keys(data.versions)
    version = semver.maxSatisfying(versions, version)

    if (!version) {
      throw new Error('Version doesn\'t exist')
    }
  }

  return version
}

export function isDistTag (data, version) {
  return data['dist-tags'][version]
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
      let dlDir = getDownloadDir(name, version)
      await ensureFolder(dlDir)
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
  let dlDir = getDownloadDir(name, exactVersion)
  await ensureFolder(dlDir)
  await downloadAndExtract(data.dist.tarball, dlDir)
  const fullFilePath = path.join(dlDir, filePath)
  if (!(fullFilePath.indexOf(dlDir) === 0)) throw new errors.Forbidden()
  return fullFilePath
}

export async function readFile (address, options) {
  const fullFilePath = await downloadFile(address)
  const result = await fs.promises.readFile(fullFilePath, options)
  return result
}

export function createReadStream (address, options = {}) {
  if (!address) throw new errors.BadRequest()
  const pass = new stream.PassThrough()
  process.nextTick(async function () {
    try {
      let { name, version, pkgUrl, filePath } = parseAddress(address)
      let usedCache = false
      let { data } = await readCachedPkgIndexData(name)
      const { preferCache = false } = options
      delete options.preferCache
      if (preferCache && !!data && !semver.valid(version)) {
        const exactVersion = getExactVersion(data, version)
        const dlDir = getDownloadDir(name, exactVersion)
        const cachedFilePath = getFullFilePath(dlDir, filePath)
        const rs = fs.createReadStream(cachedFilePath, options)
        usedCache = true
        rs.pipe(pass)
      } else if (!!data && semver.valid(version)) {
        // check if there has exist version
        let hitCache = false
        try {
          const dlDir = getDownloadDir(name, version)
          const cachedFilePath = getFullFilePath(dlDir, filePath)
          await fs.promises.access(cachedFilePath, fs.constants.R_OK)
          const rs = fs.createReadStream(cachedFilePath, options)
          hitCache = true
          rs.pipe(pass)
        } catch (e) {
        }
        if (hitCache) return
      }

      try {
        let { exactVersion, data: versionData } = await fetchPkgData(name, pkgUrl, version)
        let dlDir = getDownloadDir(name, exactVersion)
        await ensureFolder(dlDir)
        await downloadAndExtract(versionData.dist.tarball, dlDir)
        if (!usedCache) {
          const cachedFilePath = getFullFilePath(dlDir, filePath)
          const rs = fs.createReadStream(cachedFilePath, options)
          rs.pipe(pass)
        }
      } catch (e) {
        if (!usedCache) {
          throw e
        }
      }
    } catch (e) {
      console.log(e)
      pass.emit('error', e)
    }
  })

  return pass
}
