// MODIFYING react-docgen/src/handlers/propTypeHandler.js
// import getPropType from '../utils/getPropType';
// import getPropertyName from '../utils/getPropertyName';
// import getMemberValuePath from '../utils/getMemberValuePath';
// import isReactModuleName from '../utils/isReactModuleName';
// import isRequiredPropType from '../utils/isRequiredPropType';
// import printValue from '../utils/printValue';
// // import recast from 'recast';
// import resolveToModule from '../utils/resolveToModule';
// import resolveToValue from '../utils/resolveToValue';

const fs = require('fs');
const { resolve, dirname } = require('path');
const recast = require('recast')
const docgen = require('react-docgen');
const babylon = require('react-docgen/dist/babylon').default
const setPropDescription = require('react-docgen/dist/utils/setPropDescription').default
const isRequiredPropType = require('react-docgen/dist/utils/isRequiredPropType').default

const {
  getPropType,
  getPropertyName,
  getMemberValuePath,
  isReactModuleName,
  printValue,
  resolveToModule,
  resolveToValue,
  // appended
  getNameOrValue,
} = docgen.utils;

const HOP = Object.prototype.hasOwnProperty
const createObject = Object.create

const {
  types: { namedTypes: types },
} = recast;

console.log('types', types);

function isPropTypesExpression(path) {
  const moduleName = resolveToModule(path);
  if (moduleName) {
    return isReactModuleName(moduleName) || moduleName === 'ReactPropTypes';
  }
  return false;
}

function getImportedValuePath() {}

// we will amend this method to follow imports
// function amendPropTypes(getDescriptor, path) {
function amendPropTypes(getDescriptor, documentation, path, filepath) {
  // console.log('amendPropTypes', filepath, path.get('properties'));

  if (!types.ObjectExpression.check(path.node)) {
    console.log('amendPropTypes bailing', filepath, path.node);
    return;
  }

  path.get('properties').each(function(propertyPath) {
    // console.log('amendPropTypes properties iter', filepath, propertyPath);
    switch (propertyPath.node.type) {
      case types.Property.name: {
        const propDescriptor = getDescriptor(getPropertyName(propertyPath));
        const valuePath = propertyPath.get('value');
        const type = isPropTypesExpression(valuePath)
          ? getPropType(valuePath)
          : { name: 'custom', raw: printValue(valuePath) };
        console.log('property name type', getPropertyName(propertyPath), type);
        if (type) {
          propDescriptor.type = type;
          propDescriptor.required =
            type.name !== 'custom' && isRequiredPropType(valuePath);
        }
        setPropDescription(documentation, propertyPath);
        break;
      }
      case types.SpreadElement.name: {
        throw new Error('FOUND SPREAD ELEMENT');
        const resolvedValuePath = resolveToValue(propertyPath.get('argument'));
        switch (resolvedValuePath.node.type) {
          case types.ObjectExpression.name: // normal object literal
            amendPropTypes(getDescriptor, documentation, resolvedValuePath, filepath);
            break;
          // case types.ImportDeclaration.name:
          //   throw 'yep, that was the spread';
          //   break;
        }
        break;
      }
      case types.SpreadProperty.name: {
        const variableName = getNameOrValue(propertyPath.get('argument'));
        console.log('propertyPath: HANDLE SPREAD PROPERTY', propertyPath);
        console.log('TODO: HANDLE SPREAD PROPERTY', variableName);
        console.log('propertyPath', filepath, propertyPath.get('argument').get('id'))
        // const externalPropTypesPaths = resolveToImportedPaths(propertyPath.parentPath.parentPath, filepath);
        const externalPropTypesPaths = resolveToImportedPaths(path, filepath);
        externalPropTypesPaths.forEach(
          ({ moduleTargetPath, moduleFilePath }) => {
            console.log('external', moduleFilePath);
            amendPropTypes(getDescriptor, documentation, resolveToValue(moduleTargetPath), moduleFilePath);
          }
        );

        // console.log('TODO: HANDLE SPREAD PROPERTY', propertyPath.get('argument').get('id'));
        break;
      }
      default: {
        console.log('NO CASE', propertyPath.node.type);
      }
    }
  });
}

/**
 * Accepts absolute path of a source file and returns the file source as string.
 * @method getSrc
 * @param  {String} filepath  File path of the component
 * @return {String} Source code of the given file if file exist else returns empty
 */
function getSrc(filepath) {
  if (fs.existsSync(filepath) === false) return;
  return fs.readFileSync(filepath, 'utf-8');
}

function getAST(src) {
  return recast.parse(src, {
    source: 'module',
    esprima: babylon,
  });
}

function getImportsForLocalVariablesFromAST(ast) {
  const specifiers = createObject(null);

  recast.visit(ast, {
    visitImportDeclaration: path => {
      // import { foo } from '<name>'
      const name = path.node.source.value;
      path.node.specifiers.forEach(node => {
        // let target;
        // switch(node.type) {
        //   case types.ImportDefaultSpecifier: {
        //     target = 'default';
        //   }
        // }

        console.log('getImportsForLocalVariablesFromAST node', node);
        specifiers[node.local.name] = {
          modulePath: name,
          target: node.imported && node.imported.name || node.local.name,
        };
      });
      return false;
    },
  });

  return specifiers;
}

/**
 * Resolves propTypes source file path relative to current component,
 * which resolves only file extension of type .js or .jsx
 *
 * @method resolveImportModulePath
 * @param  {String} filepath  Relative file path of the component
 * @param  {String} modulePath Relative file path of a dependent component
 * @return {String} Resolved file path if file exist else null
 */
function resolveImportModuleFilePath(filepath, modulePath) {
  const regEx = /\.(js|jsx)$/;
  const srcPath = resolve(dirname(filepath), modulePath);

  if (regEx.exec(srcPath)) return srcPath;

  const extensions = ['js', 'jsx'];

  for (let ext of extensions) {
    if (fs.existsSync(`${srcPath}.${ext}`)) {
      return `${srcPath}.${ext}`;
    }
  }

  // if (fs.existsSync(`${srcPath}.js`)) return 
  // extension = 
  // return `${srcPath}`
  // if (regEx.exec(srcPath)) {
  //   return srcPath
  // } else {
  //   srcPath += fs.existsSync(`${srcPath}.js`) ? '.js' : '.jsx'
  //   return srcPath
  // }
}

/**
 * Filters the list of identifier node values or node paths from a given AST.
 *
 * @method getIdentifiers
 * @param  {Object} ast Root AST node of a component
 * @return {Object} Which holds identifier relative file path as `key` and identifier name as `value`
 */
function getIdentifiers(ast) {
  const identifiers = createObject(null);

  recast.visit(ast, {
    visitVariableDeclarator(path) {
      const node = path.node
      const nodeType = node.init.type

      if (nodeType === types.Identifier.name) {
        console.log('THIS NODE TYPE', node);
        // if (identifiers[node.init.name]) {
        //   identifiers[node.id.name].push(node.init.value);
        // } else {
        //   identifiers[node.id.name] = [node.init.value];
        // }

        if (identifiers[node.init.name]) {
          identifiers[node.init.name].push(node.init.name);
        } else {
          identifiers[node.init.name] = [node.init.name];
        }
      } else if (nodeType === types.Literal.name) {
        if (identifiers[node.id.name]) {
          identifiers[node.id.name].push(node.init.value);
        } else {
          identifiers[node.id.name] = [node.init.value];
        }
      } else if (nodeType === types.ArrayExpression.name) {
        if (identifiers[node.id.name]) {
          identifiers[node.id.name].push(node.init.elements);
        } else {
          identifiers[node.id.name] = node.init.elements;
        }
      } else if (nodeType === types.ObjectExpression.name) {
        if (identifiers[node.id.name]) {
          identifiers[node.id.name].push({
            path,
            value: node.init.properties,
          })
        } else {
          identifiers[node.id.name] = {
            path,
            value: node.init.properties,
          }
        }
      }

      this.traverse(path);
    }
  });

  return identifiers;
}


/**
 * Method to parse and get computed nodes from a document object
 *
 * @method getComputedPropValueNamesFromDoc
 * @param  {Object} doc  react-docgen document object
 * @return {Object/Boolean} Object with computed property identifer as `key` and AST node path as `value`,
 *                          If documnet object have any computed properties else return false.
 */

function getComputedPropValueNamesFromDoc(doc, output = []) {
  let flag;
  // const computedProps = createObject(null);
  const props = doc.toObject().props;

  flag = false

  if (!props) return false;

  for (const prop in props) {
    console.log('prop', prop);
    if (!HOP.call(props, prop)) continue;
    gatherComputedPropValues(props[prop].type, output);
    continue;
  }
  //   const o = props[prop];
  //   console.log('has prop', o);
  //   if (o.type && o.type.name !== 'enum') continue;
  //   if (!o.type.computed) {

  //     continue;
  //   };
  //   computedProps[o.type.value] = o;
  // }
  // if (Object.keys(computedProps).length === 0) return false;
  if (output.length === 0) return false;
  return output;
}

function gatherComputedPropValues(docPropType, output = []) {
  const type = docPropType;
  if (!type) return output;
  if (Array.isArray(type.value)) {
    type.value.forEach(propValueType => gatherComputedPropValues(propValueType, output));
    // return output;
  }
  if (type.computed) {
    output.push(type.value);
  }
  return output;

  // if (type.name === 'enum' && type.computed) {
  //   output.push = type.value;

  // } 

  // if (type.name !== 'enum') return output;
  // if (Array.isArray(type.value)) {
  //   gather
  //   return output;
  // }
}

function resolveToImportedPaths(path, filepath) {
  console.log('resolveToImportedValue', filepath, path);

  const variableNames = [];
  const paths = [];

  switch (path.node.type) {
    case types.ObjectExpression.name: {
      path.get('properties').each(propertyPath => {
        if (!types.SpreadProperty.check(propertyPath.value)) {
          // paths.push(propertyPath);
          return;
        };
        const variableName = getNameOrValue(resolveToValue(propertyPath).get('argument')); // local variable name
        variableNames.push(variableName);
      });
      break;
    }
    case types.Identifier.name: {
      variableNames.push(getNameOrValue(path)); // gives local variable name when literal assignment
      // console.log('TODO: IDENTIFIER resolveToImportedValue', filepath);
      break;
    }
    default: {
      console.log('UNHANDELED resolveToImportedPaths', path.node)
      // throw new Error('UNHANDELED resolveToImportedPaths');
    }
  }

  console.log('variableNames', variableNames);

  const ast = path.scope.getGlobalScope().node;
  const imports = getImportsForLocalVariablesFromAST(ast);
  console.log('imports', imports);

  const importedPaths = variableNames.reduce((memo, variableName) => {
    const resolvedPath = resolveVariableNameToPathFollowingImports(variableName, { ast, imports, filepath });
    if (resolvedPath) {
      memo.push(resolvedPath);
    }
    return memo;
  }, []);
  console.log('importedPaths', importedPaths);
  return paths.concat(importedPaths);
}

function resolveVariableNameToPathFollowingImports(variableName, { ast, imports, filepath }) {
  // const variableName = getNameOrValue(identifierPath); // local variable name

  console.log('resolveVariableNameToPathFollowingImports', variableName);
  if (!HOP.call(imports, variableName)) {
    // TODO: aggregate properties from local values
    return;
  }
  const { modulePath, target } = imports[variableName];
  // only process relative imports (not node_modules dependencies)
  if (!modulePath.startsWith('./')) {
    return;
  }

  const moduleFilePath = resolveImportModuleFilePath(filepath, modulePath);
  const moduleSrc = getSrc(moduleFilePath);
  const moduleAST = getAST(moduleSrc);
  console.log('imports[variableName]', imports[variableName]);
  // const moduleIdentifiers = getIdentifierNodes(moduleAST)
  const moduleIdentifiers = getIdentifiers(moduleAST)
  console.log('moduleIdentifiers', moduleIdentifiers);
  const moduleTarget = moduleIdentifiers[target];

  if (!moduleTarget) {
    // TODO: better error, or none at all
    throw new Error('no moduleTarget');
  }

  const moduleTargetPath = resolveToValue(moduleTarget.path);

  return { moduleTargetPath, moduleFilePath };
  // const moduleTargetPath = moduleTarget.path;
  // console.log('moduleTarget resolveIdentifierPathToValuesFollowingImports', moduleTargetPath);

  // return resolveToValueFollowImports(moduleTargetPath, { ast: moduleAST, filepath: moduleFilePath });
  // // return moduleTarget.path;

}

function getExternalPropTypeHandler(propName) {
  return function getExternalPropTypeHandlerForFilePath(filepath) {
    console.log('getExternalPropTypeHandler', propName, filepath);
    return function externalPropTypeHandler(documentation, path) {
      console.log('documentation', documentation);
      console.log('identifiers', getIdentifiers(path.scope.getGlobalScope().node))
      let propTypesPath = getMemberValuePath(path, propName);
      if (!propTypesPath) {
        return;
      }
      console.log('propTypesPath', propTypesPath)
      // propTypesPath = resolveToValue(propTypesPath);
      // console.log('paths', paths);
      // if (!propTypesPath) {
      //   return;
      // }
      let getDescriptor;
      switch (propName) {
        case 'childContextTypes':
          getDescriptor = documentation.getChildContextDescriptor;
          break;
        case 'contextTypes':
          getDescriptor = documentation.getContextDescriptor;
          break;
        default:
          getDescriptor = documentation.getPropDescriptor;
      }

      getDescriptor = getDescriptor.bind(documentation);

      const internalPropTypesPath = resolveToValue(propTypesPath);
      if (internalPropTypesPath) {
        amendPropTypes(getDescriptor, documentation, internalPropTypesPath, filepath);
      }

      const externalPropTypesPaths = resolveToImportedPaths(propTypesPath, filepath);
      // amendPropTypes(getDescriptor.bind(documentation), propTypesPath, filepath);
      externalPropTypesPaths.forEach(
        ({ moduleTargetPath, moduleFilePath }) =>
          amendPropTypes(
            // getDescriptor.bind(documentation),
            getDescriptor,
            documentation,
            resolveToValue(moduleTargetPath),
            moduleFilePath),
      );
      // amendPropTypes(getDescriptor.bind(documentation), propTypesPath, filepath);

      // const computedPropNames = getComputedPropValueNamesFromDoc(documentation)
      // console.log('computedPropNames', computedPropNames)
      // // if (!computedPropNames) {
      // //   return
      // // }

      const computedPropValueNames = getComputedPropValueNamesFromDoc(documentation);
      console.log('computedPropValueNames', computedPropValueNames);
      const identifiers = getIdentifiers(path.scope.getGlobalScope().node);
      const ast = path.scope.getGlobalScope().node;
      const imports = getImportsForLocalVariablesFromAST(ast);

      console.log('identifiers', identifiers);

      for (const key in identifiers) {
        console.log(key);
        const resolvedVars = resolveVariableNameToPathFollowingImports(key, { ast, imports, filepath });
        console.log('resolved vars');
      }

    }
  }

  // return function(documentation, path) {
  //   console.log('documentation', documentation);
  //   console.log('path', path)
  //   let propTypesPath = getMemberValuePath(path, propName);
  //   if (!propTypesPath) {
  //     return;
  //   }
  //   propTypesPath = resolveToValue(propTypesPath);
  //   if (!propTypesPath) {
  //     return;
  //   }
  //   let getDescriptor;
  //   switch (propName) {
  //     case 'childContextTypes':
  //       getDescriptor = documentation.getChildContextDescriptor;
  //       break;
  //     case 'contextTypes':
  //       getDescriptor = documentation.getContextDescriptor;
  //       break;
  //     default:
  //       getDescriptor = documentation.getPropDescriptor;
  //   }
  //   amendPropTypes(getDescriptor.bind(documentation), propTypesPath);
  // };
}


// export const propTypeHandler = getPropTypeHandler('propTypes');
// export const contextTypeHandler = getPropTypeHandler('contextTypes');
// export const childContextTypeHandler = getPropTypeHandler('childContextTypes');
// module.exports = getPropTypeHandler('propTypes');
module.exports.propTypeHandler = getExternalPropTypeHandler('propTypes');
module.exports.contextTypeHandler = getExternalPropTypeHandler('contextTypes');
module.exports.childContextTypeHandler = getExternalPropTypeHandler('childContextTypes');