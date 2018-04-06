/* global process,require */
const jsyaml = require('js-yaml')
const colors = require('colors')

const includeYamlType = new jsyaml.Type('!include', {
  kind: 'scalar',
  construct: function (filename) {
    return readYaml(filename)
  }
})

const BUILD_SCHEMA = jsyaml.Schema.create([includeYamlType])

const readYaml = filename => {
  const data = require('fs').readFileSync(require('path').resolve(filename), 'utf8')
  return jsyaml.safeLoad(data, {schema: BUILD_SCHEMA})
}

const getAttribute = (object, path) => path.split('.').reduce((memo, key) => (memo && memo[key]), object)

const log = ['title:underline', 'info:green', 'warn:yellow', 'error:red'].reduce((memo, key) => {
  const [fn, color] = key.split(':')
  memo[fn] = message => console.log(colors[color](message))
  return memo
}, {})

const extractLambdaArn = uri => {
  const str = typeof uri === 'string' ? uri : JSON.stringify(uri)
  const match = str.match(/functions\/([^/]*)\/invocations/)
  return match && match[1]
}

const findResources = (template, type) => {
  if (!(template && template.Resources)) {
    return {}
  }
  return Object.keys(template.Resources).reduce((memo, logicalName) => {
    const resource = template.Resources[logicalName]
    if (resource.Type === type) {
      memo[logicalName] = resource
    }
    return memo
  }, {})
}

const addApiLambdaPermissions = template => {
  log.title('Adding API Lambda invoke permissions')
  const apiResources = findResources(template, 'AWS::Serverless::Api')
  Object.keys(apiResources).forEach((logicalName) => {
    const api = apiResources[logicalName]
    const paths = getAttribute(api, 'Properties.DefinitionBody.paths')
    if (paths) {
      const arns = new Set()
      Object.keys(paths).map(pathName => paths[pathName]).forEach(path => {
        Object.keys(path).map(methodName => path[methodName]).forEach((method) => {
          const integration = method['x-amazon-apigateway-integration']
          if (integration && integration.type === 'aws_proxy' && integration.uri) {
            const lambdaArn = extractLambdaArn(integration.uri)
            if (lambdaArn) {
              arns.add(lambdaArn)
            } else {
              log.warn(`Could not extract Lambda ARN from URI "${JSON.stringify(integration.uri)}"`)
            }
          }
        })
      })
      Array.from(arns).sort().forEach((arn, index) => {
        log.info(`Adding permission for API ${logicalName} to call Lambda ${arn}`)
        template.Resources[`${logicalName}LambdaPermission${index + 1}`] = {
          Type: 'AWS::Lambda::Permission',
          Properties: {
            FunctionName: {
              'Fn::Sub': arn
            },
            Action: 'lambda:InvokeFunction',
            Principal: 'apigateway.amazonaws.com',
            SourceArn: {
              'Fn::Sub': 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${' + logicalName + '}/*/*/*' // eslint-disable-line
            }
          }
        }
      })
    } else {
      log.warn(`API "${logicalName}" does not specify body with paths`)
    }
  })
  console.log()
  return template
}

const expandApis = template => {
  log.title('Expanding API resources')
  const apiResources = findResources(template, 'CFBuild::RestApi')
  Object.keys(apiResources).forEach((logicalName) => {
    const api = apiResources[logicalName]
    delete template.Resources[logicalName]
    log.info(`Adding AWS::APIGateway::RestApi resource for ${logicalName}`)
    template.Resources[logicalName] = {
      Type: 'AWS::ApiGateway::RestApi',
      Properties: {
        Name: api.Properties.Name,
        Body: api.Properties.Body
      }
    }
    log.info(`Adding AWS::APIGateway::Deployment resource for ${logicalName}`)
    const deploymentResourceName = logicalName + 'Deployment'
    template.Resources[deploymentResourceName] = {
      Type: 'AWS::ApiGateway::Deployment',
      Properties: {
        RestApiId: {
          Ref: logicalName
        }
      }
    }
    log.info(`Adding AWS::APIGateway::Stage resource for ${logicalName}`)
    const stageResourceName = logicalName + 'Stage'
    template.Resources[stageResourceName] = {
      Type: 'AWS::ApiGateway::Stage',
      Properties: {
        RestApiId: {
          Ref: logicalName
        },
        StageName: api.Properties.StageName,
        DeploymentId: {
          Ref: deploymentResourceName
        }
      }
    }
    if (api.Properties.BasePath && api.Properties.DomainName) {
      log.info(`Adding AWS::APIGateway::BasePathMapping resource for ${logicalName}`)
      template.Resources[logicalName + 'Mapping'] = {
        Type: 'AWS::ApiGateway::BasePathMapping',
        Properties: {
          BasePath: api.Properties.BasePath,
          DomainName: api.Properties.DomainName,
          RestApiId: {
            Ref: logicalName
          },
          Stage: api.Properties.StageName
        },
        DependsOn: stageResourceName
      }
    }
  })
  console.log()
  return template
}

const phases = [
  expandApis,
  addApiLambdaPermissions
]

const processTemplate = template => {
  return phases.reduce((memo, phase) => {
    return phase(memo)
  }, template)
}

const readTemplate = ({template}) => {
  return new Promise((resolve) => {
    return resolve(readYaml(template))
  })
}

const writeTemplate = ({output}) => template => {
  return new Promise(resolve => {
    log.title('Writing template')
    require('fs').writeFileSync(require('path').resolve(output), jsyaml.safeDump(template, {
      noRefs: true
    }), 'utf8')
    return output
  })
}

module.exports = (argv) => {
  const args = [
    { name: 'template', alias: 't', type: String },
    { name: 'output', alias: 'o', type: String }
  ]
  const options = require('command-line-args')(args, { argv })
  return readTemplate(options)
    .then(processTemplate)
    .then(writeTemplate(options))
}
