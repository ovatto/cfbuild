const jsyaml = require('js-yaml')
const colors = require('colors')

const include = path => readYaml(path)

const lambdaProxy = data => {
  return {
    "uri": data.uri,
    "passthroughBehavior": (data.passthroughBehavior || "when_no_match"),
    "httpMethod": "POST",
    "type": "aws_proxy"
  }
}

const createBucket = data => {
  return {
    Type: 'AWS::S3::Bucket',
    Properties: {
      BucketName: data.Name
    }
  }
}

const createLambda = data => {
  return {
    Type: 'AWS::Lambda::Function',
    Properties: {
      FunctionName: data.Name,
      CodeUri: (data.Path || '.'),
      Handler: (data.Handler || 'index.handler'),
      Environment: {
        Variables: (data.Environment || {})
      }
    }
  }
}

const createApi = data => {
  return {
    Type: 'AWS::Lambda::Function',
    Properties: {
      FunctionName: data.name,
      CodeUri: (data.path || '.'),
      Handler: (data.handler || 'index.handler'),
      Environment: {
        Variables: (data.environment || {})
      }
    }
  }
}

const capitalize = str => {
  const lc = str.toLowerCase()
  return lc.slice(0,1).toUpperCase()+lc.slice(1)
}

const createLogicalName = (name, suffix) => {
  const parts = name.split(/[-_]+/).concat([suffix])
  return parts.map(part => {
    return capitalize(part.trim())
  }).join('')
}

const createLambdaResource = definition => {
  if(typeof definition.Name !== 'string') {
    throw new Error('Lambda function must have the "Name" attribute')
  }
  return {
    logicalName: createLogicalName(definition.Name, 'function'),
    definition: {
      Type: 'AWS::Lambda::Function'
    }
  }
}

const RESOURCE_TYPES = {
  Lambda: createLambdaResource
}

const createResource = resource => {
  const keys = Object.keys(resource)
  if(keys.length !== 1) {
    throw new Error(`Resource definition must have a single top level element. Found "${keys.join(',')}".`)
  }
  const type = keys[0]
  const createType = RESOURCE_TYPES[type]
  if(typeof createType !== 'function') {
    throw new Error(`Unsupported resource type "${type}".`)
  }
  return createType(resource[type])
}

const createResources = resources => {
  if(Array.isArray(resources)) {
    return resources.reduce((memo, resource) => {
      const generated = createResource(resource)
      memo[generated.logicalName] = generated.definition
      return memo
    }, {})
  }
  return {}
}

const tags = [
  { name: 'include', type: 'scalar', handler: include },
  { name: 'lambda-proxy-integration', type: 'mapping', handler: lambdaProxy },
  { name: 'lambda', type: 'mapping', handler: createLambda },
  { name: 'bucket', type: 'mapping', handler: createBucket },
  { name: 'api', type: 'mapping', handler: createApi },
  { name: 'resources', type: 'sequence', handler: createResources }
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
