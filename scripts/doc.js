const { readFile, writeFile } = require('fs').promises;
const path = require('path');
const rootPath = path.resolve(__dirname);

let json;
try {
  json = require('../doc.json');
} catch (e) {
  throw Error(
    "No doc.json file found. Run 'npm run doc' to make sure the file is in place."
  );
}

function isFunction({ kindString }) {
  return kindString === 'Function';
}

function isInterface({ kindString, type }) {
  return (
    kindString === 'Interface' ||
    (kindString === 'Type alias' &&
      type.type === 'reflection' &&
      type.declaration.children)
  );
}

function isProperty({ kindString }) {
  return kindString === 'Property';
}

const isUtility = isFunction;

function isReactComponent({ kindString, signatures }) {
  return isFunction({ kindString }) && signatures[0].type.name === 'Element';
}

function getCommentSection(typeRecord) {
  return { shortText: '', tags: [], ...typeRecord.comment };
}

function getChildren({ kindString, children, type }) {
  if (kindString === 'Interface') {
    return children;
  }
  if (
    kindString === 'Type alias' &&
    type.type === 'reflection' &&
    type.declaration.children
  ) {
    return type.declaration.children;
  }
  throw Error('No children found');
}

function typeDescription({ type, ...props }) {
  if (type === 'literal') {
    return '"' + props.value + '"';
  }
  if (props.kindString === 'Property' || props.kindString === 'Parameter') {
    return `${props.name} ${
      props.flags.isOptional ? '?' : ''
    }: ${typeDescription(type)}`;
  }
  if (type === 'reference' || type === 'intrinsic') {
    if (props.typeArguments) {
      return `${props.name}<${props.typeArguments
        .map(typeDescription)
        .join(' | ')}>`;
    }
    return props.name;
  }
  if (type === 'union') {
    return props.types.map(typeDescription).join(' | ');
  }

  if (type === 'array') {
    return `${typeDescription(props.elementType)}[]`;
  }

  if (type === 'indexedAccess') {
    return `${typeDescription(props.objectType)}[${typeDescription(
      props.indexType
    )}]`;
  }

  if (type === 'reflection') {
    if (props.declaration.children) {
      // object shaped
      return `{
            ${props.declaration.children.map(typeDescription).join('\n')}
        }`;
    }
    if (props.declaration.signatures) {
      const [signature] = props.declaration.signatures;
      if (!signature.parameters) {
        return `() => ${typeDescription(signature.type)}`;
      }
      // function literal
      return `(
          ${signature.parameters
            .map(typeDescription)
            .join(',\n')}) => ${typeDescription(signature.type)}`;
    }
  }
}

const rewriteRecord = (typeRecord) => {
  if (isReactComponent(typeRecord)) {
    return {
      type: 'Component',
      name: typeRecord.name,
      description: getCommentSection(typeRecord.signatures[0]).shortText,
      returnType: typeDescription(typeRecord.signatures[0].type),
      props: typeRecord.signatures.flatMap(({ parameters }) =>
        parameters.map(typeDescription)
      )
    };
  }
  if (isUtility(typeRecord)) {
    return {
      type: typeRecord.kindString,
      name: typeRecord.name,
      description: typeRecord.signatures
        .flatMap(({ comment }) => comment.shortText)
        .join('\n'),
      returnType: typeDescription(typeRecord.signatures[0].type),
      props: typeRecord.signatures
        .flatMap(
          ({ parameters }) => parameters && parameters.map(typeDescription)
        )
        .filter(Boolean)
    };
  }
  if (isInterface(typeRecord)) {
    return {
      type: typeRecord.kindString,
      name: typeRecord.name,
      description: getCommentSection(typeRecord).shortText,
      children: getChildren(typeRecord).map(rewriteRecord)
    };
  }
  if (isProperty(typeRecord)) {
    return {
      type: typeRecord.kindString,
      name: typeRecord.name,
      description: getCommentSection(typeRecord).shortText,
      isOptional: typeRecord.flags.isOptional,
      valueType: typeDescription(typeRecord.type),
      defaultValue: getCommentSection(typeRecord)
        .tags.filter(({ tag }) => tag === 'defaultvalue')
        .map(({ text }) => text)
    };
  }
  return {
    type: typeRecord.kindString,
    name: typeRecord.name,
    description: getCommentSection(typeRecord).shortText,
    valueType: typeDescription(typeRecord.type)
  };
};

const types = json.children.flatMap(rewriteRecord);

readFile(path.normalize(rootPath + '/readme.template'), {
  encoding: 'UTF8'
})
  .then((readme) => {
    const SEPARATOR = '\n\n___\n\n';
    const markdown = `
  ## Components

  ${types
    .filter(({ type }) => type === 'Component')
    .map(({ name, ...props }, i) => {
      const param = props.props[0].replace('__namedParameters : ', '');
      const { children } = types.find(({ name }) => name === param);
      return `#### ${name}

      ${props.description.replace(/\n/g, '  \n')}

    props: \`${param}\`

    ${
      i > 0
        ? ''
        : `The ${param} object contains the following properties:

            ${children
              .map(
                ({
                  name,
                  valueType,
                  defaultValue,
                  description,
                  isOptional
                }) => {
                  return `* **${name}**${
                    isOptional ? ' ?:' : ':'
                  } \`${valueType}\`${
                    defaultValue && defaultValue.length
                      ? ` = ${defaultValue[0]}`
                      : ''
                  }  \n
                ${description.replace(/\n/g, '  \n')}`;
                }
              )
              .join(SEPARATOR)}`
    }
    `;
    })
    .join('\n\n')}
  ${SEPARATOR}
  ## Types

  ${types
    .filter(({ name, type }) => !/Props$/.test(name) && /Type/.test(type))
    .map(({ name, valueType, description, children }) => {
      if (children) {
        return `**${name}**: \`{${children
          .map(({ name, valueType }) => `${name}: ${valueType}`)
          .join(', ')}}\`  \n
        ${description.replace(/\n/g, '  \n')}`;
      }
      return `**${name}**: \`${valueType}\`  \n
        ${description.replace(/\n/g, '  \n')}`;
    })
    .join(SEPARATOR)}
  ${SEPARATOR}
  ${types
    .filter(({ type }) => type === 'Interface')
    .map(({ name, description, children }) => {
      return `**${name}**\n
        ${description.replace(/\n/g, '  \n')}
        
        ${children
          .map(({ name, description, isOptional, valueType }) => {
            return `* ${name}${isOptional ? ' ?:' : ':'} \`${valueType}\`  \n
            ${description.replace(/\n/g, '  \n')}`;
          })
          .join('\n')}`;
    })
    .join(SEPARATOR)}
  ${SEPARATOR}
  ## Utilites

  ${types
    .filter(({ type }) => type === 'Function')
    .map(({ name, description, returnType, props }) => {
      return `#### ${name}\n
        
        \`${name}(${props.length ? props.join('`, `') : ''}) => ${returnType}\`

        ${description.replace(/\n/g, '  \n')}
        `;
    })}
    `
      .split('\n')
      .map((line) => line.trimStart())
      .join('\n');
    const result = readme.replace('{{api}}', markdown);

    return Promise.all([
      writeFile(path.normalize(rootPath + '/../README.md'), result, {
        encoding: 'UTF8'
      }),
      writeFile(
        path.normalize(rootPath + '/../example/public/doc.md'),
        markdown,
        {
          encoding: 'UTF8'
        }
      )
    ]);
  })
  .then(() => console.log('All done!'));
