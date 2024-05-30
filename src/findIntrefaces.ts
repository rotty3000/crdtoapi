#!/usr/bin/env node

import { Command } from 'commander';
import { load } from 'js-yaml';
import { readFile } from 'fs/promises';
import Mustache from 'mustache';
import { metaDataInerfaceTemplate } from './metadataInterface';
import path from 'path';
import { writeFileSync } from 'fs';

const FileHeaderTemplate = `/**
 * {{openAPITitle}}
 * {{openAPIDescription}}
 *
 * The version of the OpenAPI document: {{openAPIVersion}}
 * Contact Email: {{OpenAPIContactEmail}}
 * License: {{OpenAPILicense}}
 *
 * NOTE: This file is auto generated by crdtotypes (https://github.com/yaacov/crdtoapi/).
 * https://github.com/yaacov/crdtoapi/README.crdtotypes
 */

`;

const IntrefaceHeaderemplate = `/**
 * {{description}}
 *
 * @export
 */
`;

/**
 * Define the CLI options
 */
const program = new Command();
program
  .version('0.0.15')
  .description('Extract Typescropt interfaces from OpenAPI file')
  .option('-i, --in <file>', 'OpenAPI file - required')
  .option('-o, --out <dir>', 'Output directory name (defatult: no output)')
  .option('-j, --json', 'Dump JSON output for debugging (defatult: false)')
  .option(
    '--metadataType <string>',
    'Override metadata fields with type (defatult: IoK8sApimachineryPkgApisMetaV1ObjectMeta)',
  )
  .option(
    '--fallbackType <string>',
    'Override for field with missing type(defatult: unknown | null;)',
  )
  .parse(process.argv);

const options = program.opts();

if (!options.in) {
  console.log('error: missing mandatory argument --in');
  process.exit(1);
}

if (!options.metadataType) {
  options.metadataType = 'IoK8sApimachineryPkgApisMetaV1ObjectMeta';
}

if (!options.fallbackType) {
  options.fallbackType = 'unknown | null';
}

/** LicenseObject
 *
 * https://spec.openapis.org/oas/v3.1.0#license-object
 */
interface LicenseObject {
  name: string;
  identifier?: string;
  url?: string;
}

/** InfoObject
 *
 * https://spec.openapis.org/oas/v3.1.0#info-object
 */
interface InfoObject {
  title: string;
  version: string;
  license?: LicenseObject;
  description?: string;
  contact?: {
    name?: string;
    url?: string;
    email?: string;
  };
}

/** BasicSchemaTypes
 *
 * note: 'object' and 'array' will be handled differently
 * Data types:
 * https://datatracker.ietf.org/doc/html/draft-bhutton-json-schema-00#section-4.2.1
 */
type BasicSchemaTypes = 'null' | 'boolean' | 'number' | 'string' | 'integer' | 'date'; // note: date is not part of OpenAPI

/** SchemaFormats
 *
 * Formats:
 * https://datatracker.ietf.org/doc/html/draft-bhutton-json-schema-validation-00#section-7.3
 * Dates:
 * https://datatracker.ietf.org/doc/html/rfc3339#section-5.6
 */
type SchemaFormats =
  | 'int32'
  | 'int64'
  | 'float'
  | 'double'
  | 'password'
  | 'date-time'
  | 'time'
  | 'date'
  | 'email'
  | 'email'
  | 'regex';

/** SchemaObject
 *
 * https://spec.openapis.org/oas/v3.1.0#schema-object
 */
interface BasicSchemaObject {
  type: BasicSchemaTypes;
  description?: string;

  format?: SchemaFormats;
  enum?: unknown[]; // type is union of enums
  pattern?: string;
  default?: unknown;
}

interface ArraySchemaObject {
  type: 'array';
  description?: string;

  items: SchemaObject;
}

interface ObjectSchemaObject {
  type: 'object';
  description?: string;

  properties?: {
    [name: string]: SchemaObject;
  };
  required?: string[];
}

type SchemaObject = BasicSchemaObject | ArraySchemaObject | ObjectSchemaObject;

/** ComponentsObject
 *
 * https://spec.openapis.org/oas/v3.1.0#components-object
 */
interface ComponentsObject {
  schemas?: {
    [id: string]: SchemaObject;
  };
}

/** OpenAPIObject
 *
 * https://spec.openapis.org/oas/v3.1.0#openapi-object
 */
interface OpenAPIObject {
  openapi: string;
  info: InfoObject;
  components?: ComponentsObject;
}

/** Typescript type field
 *
 * Describe a field in a type or interface
 */
interface TypeScriptTypeField {
  name: string;
  description?: string;
  type: string;
  isArray?: boolean;
  isObject: boolean;
  originalType?: string;
  format?: SchemaFormats;
  enum?: unknown[]; // type is union of enums
  pattern?: string;
  default?: unknown;
  required?: boolean;
}

/** Typescript type field
 *
 * Describe a type or interface
 */
interface TypeScriptType {
  parent: string;
  name: string;
  description?: string;
  fields: { [id: string]: TypeScriptTypeField };
  required?: string[];
}

// GLOBALS START

/**
 * Store the OpenAPI file information
 */
let yaml: OpenAPIObject;

/**
 * Store all the Typescript types we can extract from
 * the input schema
 */
const schemaTypes: { [id: string]: TypeScriptType } = {};

// GLOBALS END

/**
 * Extract Typescropt types from a SchemaObject
 *
 * @param parent is the name of the parent type
 * @param field current field name in tree
 * @param schema the current field schema
 * @param isArray is the field an array field
 */
const extractTypes = (parent: string, field: string, schema: SchemaObject, isArray = false) => {
  let type: string;

  switch (schema.type) {
    case 'array':
      extractTypes(parent, field, schema.items, true);
      break;
    case 'object':
      type = `${parent}${field.charAt(0).toUpperCase() + field.slice(1)}`;

      // Init new type
      schemaTypes[type] = {
        parent: parent,
        name: type,
        description: schema.description,
        fields: {},
        required: schema.required,
      };

      // Add object type field
      if (schemaTypes[parent]) {
        schemaTypes[parent].fields[field] = {
          name: field,
          type: type,
          isArray: isArray,
          isObject: true,
          description: schema.description,

          required: (schemaTypes[parent].required || []).indexOf(field) > -1,
        };
      }

      for (const [k, v] of Object.entries(schema?.properties || {})) {
        extractTypes(type, k, v);
      }
      break;
    default:
      // Add regular type field
      schemaTypes[parent].fields[field] = {
        name: field,
        type: schema.type,
        isArray: isArray,
        isObject: false,
        description: schema.description,

        format: schema.format,
        enum: schema.enum,
        pattern: schema.pattern,
        default: schema.default,
        required: (schemaTypes[parent].required || []).includes(field),
      };
      break;
  }
};

/**
 * Read OpenAPI file
 *
 * @param filePath is the OpenAPI file to read
 * @returns a dictionary with all the schemas objects by kind and version
 */
const readSchema = async (filePath: string) => {
  try {
    const fileContent = await readFile(filePath, 'utf8');

    if (filePath.endsWith('.json')) {
      yaml = JSON.parse(fileContent) as OpenAPIObject;
    } else {
      yaml = load(fileContent) as OpenAPIObject;
    }

    for (const [key, schema] of Object.entries(yaml.components?.schemas || {})) {
      extractTypes('', key, schema);
    }
  } catch (error) {
    console.log(`error occurr ed while reading input file (${error})`);
    process.exit(1);
  }

  return;
};

/**
 * Take the global schemaTypes variable and convert it to typescrtipt descriptions
 *
 * @returns a reduced version of the schemas
 */
const reduceSchema = (schemaList: {
  [id: string]: TypeScriptType;
}): { imports: string[]; type: TypeScriptType }[] => {
  const output = [];

  for (const [, type] of Object.entries(schemaList)) {
    // Check if object is valid
    if (Object.keys(type.fields).length === 0) {
      continue;
    }

    // Get list of objects this type requires
    const imports: string[] = [];
    for (const [, field] of Object.entries(type.fields)) {
      // set object type
      if (field.isObject) {
        let isObjectUndefined = false;

        // get object imports
        const childType = schemaList[field.type];
        const keys = childType && Object.keys(schemaList[field.type].fields);
        if (keys && keys.length === 0) {
          isObjectUndefined = true;
        } else {
          imports.push(field.type);
        }

        // set undefined object fallback type
        const isMetadataField = type.parent === '' && field.name === 'metadata';
        if (isMetadataField && isObjectUndefined) {
          field.originalType = field.type;
          field.type = options.metadataType;
          imports.push(field.type);
        }
        if (!isMetadataField && isObjectUndefined) {
          field.originalType = 'not defined';
          field.type = options.fallbackType;
        }
      }

      // set kind type and version
      if (type.parent === '' && field.name === 'kind' && field.type === 'string') {
        field.required = true;
      }
      if (type.parent === '' && field.name === 'apiVersion' && field.type === 'string') {
        field.required = true;
      }

      // map types to typestring types
      // ---
      // check for 'date' type
      if (field.type === 'date') {
        field.originalType = field.type;
        field.type = 'string';
        field.format = field.format || 'date';
      }

      // chekc for 'integer' type
      if (field.type === 'integer') {
        field.originalType = field.type;
        field.type = 'number';
        field.format = field.format || 'int64';
      }

      // check for 'enum' string qualifier
      if (field.enum && field.type === 'string') {
        field.originalType = field.type;
        field.type = (field.enum as unknown as string[]).map((str) => `'${str}'`).join(' | ');
      }

      // add typescript array qualifier
      if (field.isArray && field.type.includes(' ')) {
        field.type = `(${field.type})[]`;
      }
      if (field.isArray && !field.type.includes(' ')) {
        field.type = `${field.type}[]`;
      }
    }

    output.push({
      imports,
      type,
    });
  }

  return output;
};

readSchema(options.in).then(() => {
  const output = reduceSchema(schemaTypes);

  // json debug output
  if (options.json) {
    console.log(JSON.stringify(output));
  }

  // output imterface files
  if (options.out) {
    const headerTemplateData = {
      openAPITitle: yaml.info.title,
      openAPIDescription: yaml.info.description,
      openAPIVersion: yaml.info.version,
      OpenAPIContactEmail: yaml.info.contact?.email,
      OpenAPILicense: yaml.info.license?.name,
    };

    // output all valid interfaces
    // ---
    for (const tsInterface of output) {
      // check if type is valid
      if (Object.keys(tsInterface.type.fields).length !== 0) {
        let outCodeText = '';

        // render header
        outCodeText = outCodeText + Mustache.render(FileHeaderTemplate, headerTemplateData);

        // render imports
        for (const name of tsInterface.imports) {
          outCodeText = outCodeText + `import { ${name} } from './${name}';\n`;
        }
        if (tsInterface.imports.length !== 0) {
          outCodeText = outCodeText + '\n';
        }

        // render interface
        if (tsInterface.type.description !== undefined) {
          const interfaceTemplateData = {
            description: tsInterface.type.description,
            parent: tsInterface.type.parent,
          };
          outCodeText =
            outCodeText + Mustache.render(IntrefaceHeaderemplate, interfaceTemplateData);
        }
        outCodeText = outCodeText + `export interface ${tsInterface.type.name} {\n`;

        for (const [, field] of Object.entries(tsInterface.type.fields)) {
          outCodeText = outCodeText + (field.name !== undefined ? `  /** ${field.name}\n` : '');
          outCodeText =
            outCodeText +
            (field.description !== undefined ? `   * ${field.description}\n   *\n` : '   *\n');

          outCodeText =
            outCodeText +
            (field.required !== undefined ? `   * @required {${field.required}}\n` : '');
          outCodeText =
            outCodeText + (field.format !== undefined ? `   * @format {${field.format}}\n` : '');
          outCodeText =
            outCodeText + (field.pattern !== undefined ? `   * @pattern {${field.pattern}}\n` : '');
          outCodeText =
            outCodeText +
            (field.default !== undefined ? `   * @required {${field.default}}\n` : '');
          outCodeText =
            outCodeText +
            (field.originalType !== undefined
              ? `   * @originalType {${field.originalType}}\n`
              : '');
          outCodeText = outCodeText + `   */\n`;

          if (field.required) {
            outCodeText = outCodeText + `  ${field.name}: ${field.type};\n`;
          } else {
            outCodeText = outCodeText + `  ${field.name}?: ${field.type};\n`;
          }
        }

        outCodeText = outCodeText + '}\n';
        writeFileSync(path.normalize(`${options.out}/${tsInterface.type.name}.ts`), outCodeText);
      }
    }

    // output metadata interface file
    // ---
    let outMetadataCodeText = '';
    outMetadataCodeText = Mustache.render(metaDataInerfaceTemplate, headerTemplateData);
    writeFileSync(path.normalize(`${options.out}/${options.metadataType}.ts`), outMetadataCodeText);
    // ---

    // output index file
    // ---
    let outExportCodeText = '';
    outExportCodeText = Mustache.render(FileHeaderTemplate, headerTemplateData);

    const exports = Object.keys(yaml.components?.schemas || {});
    for (const name of exports) {
      outExportCodeText =
        outExportCodeText + `export * from './${name.charAt(0).toUpperCase() + name.slice(1)}';\n`;
    }
    outExportCodeText = outExportCodeText + `export * from './${options.metadataType}';\n`;

    writeFileSync(path.normalize(`${options.out}/index.ts`), outExportCodeText);
    // ---
  }
});
