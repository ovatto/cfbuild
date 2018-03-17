const commandLineArgs = require('command-line-args')

const commands = {
  lambda: require('./commands/lambda'),
  template: require('./commands/template')
}

const mainDefinitions = [
    { name: 'command', defaultOption: true }
]
const mainOptions = commandLineArgs(mainDefinitions, { stopAtFirstUnknown: true })

const command = commands[mainOptions.command]
if(typeof command !== 'function') {
  console.error(`unknown command "${mainOptions.command}"`)
  console.error('supported commands:')
  Object.keys(commands).forEach((name) => {
    console.error(` ${name}`)
  })
  process.exit(1)
}

command(mainOptions._unknown || [])
  .catch(console.error)
