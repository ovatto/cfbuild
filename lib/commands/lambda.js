const fs = require('fs-extra')
const path = require('path')
const os = require('os')

const createIgnorePattern = directory => {
  return fs.readFile(path.join(directory, '.cfignore'), 'utf8')
    .then(read => read.split(/[\r\n]+/).map(p => p.trim()).filter(p => !!p))
    .catch(() => {
      return []
    })
    .then((patterns) => {
      return ['node_modules', ...patterns]
    })
}

const copyLambdaFiles = ({ directory }) => {
  return Promise.all([
    fs.mkdtemp(path.join(os.tmpdir(), 'lambda-')),
    createIgnorePattern(directory)
  ]).then(([buildDir, ignore]) => {
    const fg = require('fast-glob')
    return fg(['**'], {
      cwd: directory,
      ignore: ignore
    }).then((entries) => {
      return Promise.all(entries.map(entry => {
        fs.copy(path.join(directory, entry), path.join(buildDir, entry))
      })).then(() => {
        return buildDir
      })
    })
  })
}

const runNpmInstall = buildDir => {
  return new Promise((resolve, reject) => {
    const { spawn } = require('cross-spawn')
    spawn('npm', ['ci', '--production'], { cwd: buildDir })
      .on('close', async code => {
        if (code !== 0) {
          return reject(new Error(`npm install failed, status ${code}, cwd: ${buildDir}`))
        }
        return resolve(buildDir)
      })
      .on('error', err => {
        return reject(new Error(`npm install errored, cwd: ${buildDir}. ${err}`))
      })
  })
}

const createLambdaPackage = ({ output }) => buildDir => {
  return new Promise((resolve, reject) => {
    const zipfile = path.resolve(output)
    const stream = fs.createWriteStream(zipfile)
    const archiver = require('archiver')
    const archive = archiver('zip', {
      zlib: { level: 9 }
    })

    const result = {
      entryCount: 0,
      warnings: [],
      zipfile
    }

    stream.on('close', () => {
      return resolve(result)
    })

    archive.on('warning', err => {
      result.warnings.push(err)
    })

    archive.on('entry', entry => {
      result.entryCount++
    })

    archive.on('error', err => {
      return reject(err)
    })

    archive.pipe(stream)
    archive.directory(buildDir, '')
    archive.finalize()
  })
}

const buildLambda = options => {
  return copyLambdaFiles(options)
    .then(runNpmInstall)
    .then(createLambdaPackage(options))
}

module.exports = (argv) => {
  const args = [
    { name: 'directory', alias: 'd', type: String },
    { name: 'output', alias: 'o', type: String }
  ]
  const options = require('command-line-args')(args, { argv })
  return buildLambda(options)
    .then(result => {
      console.log(`[cfbuild][${options.directory}] Created zip with ${result.entryCount} files - ${result.zipfile}`)
      if (result.warnings.length > 0) {
        console.log(`!!! [cfbuild][${options.directory}] Warnings:`)
        result.warnings.forEach(warning => console.log(`!!! [cfbuild][${options.directory}] ${warning}`))
      }
    })
}
