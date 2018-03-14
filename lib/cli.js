const jsyaml = require('js-yaml')
const colors = require('colors')

const include = path => readYaml(path)

const tags = [
  { name: 'include', type: 'scalar', handler: include }
]

const createTagType = tag => new jsyaml.Type(`!${tag.name}`, {
  kind: tag.type,
  construct: tag.handler
})

const schema = jsyaml.Schema.create(tags.map(createTagType))

const readYaml = path => {
  const data = require('fs').readFileSync(require('path').join(process.cwd(), path), 'utf-8')
  return jsyaml.safeLoad(data, {schema})
}

module.exports.run = (argv) => {
  if(argv.length !== 3) {
    console.error(colors.red('usage: cfbuild <filename>'))
  }
  const read = readYaml(argv[2])
  process.stdout.write(jsyaml.safeDump(read))
}
