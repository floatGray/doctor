import path from "path";
import { deepmerge, resolve } from "@umijs/utils";
import { IApi } from "../types";
import type { Root } from "@umijs/utils/compiled/@hapi/joi";
import { Config } from "@umijs/core";

interface Schema {
  [ket: string]: any;
}

function generateSchema(userSchemas: Object, root_Joi?: Root) {
  const schema: Schema = {};
  for (const [key, value] of Object.entries(userSchemas)) {
    if (typeof value === "object" && value !== null) {
      schema[key] = (Joi: Root) => {
        if (!root_Joi) {
          const root_Joi = Joi;
          return Joi?.object(generateSchema(value, root_Joi));
        } else {
          return root_Joi?.object(generateSchema(value, root_Joi));
        }
        // if (!root_Joi) {
        //   const root_Joi = Joi
        //   return Joi?.object(generateSchema(value, root_Joi));
        // } else {
        //   return root_Joi?.object(generateSchema(value, root_Joi));
        // }
      };
    } else {
      schema[key] = (Joi: Root) => {
        if (!root_Joi) {
          return Joi?.any();
        } else {
          return root_Joi?.any();
        }
      };
    }
  }
  return schema;
}

function getSchemas(userSchemas: Object): Record<string, (Joi: Root) => any> {
  return {
    ...generateSchema(userSchemas),
  };
}

export function applyConfigFromSchema(api: IApi, userSchemas: Object) {
  const schemas = getSchemas(userSchemas);
  for (const key of Object.keys(schemas)) {
    const config: Record<string, any> = {
      schema: schemas[key] || ((joi: any) => joi.any()),
    };
    api.registerPlugins([
      {
        id: `virtual: config-${key}`,
        key: key,
        config,
      },
    ]);
  }

  // support extends config
  api.modifyConfig((config) => parseExtendsConfig({ config, api }));
}

/**
 * parse extends option for config
 */
function parseExtendsConfig(opts: {
  config: Record<string, any>;
  resolvePaths?: string[];
  api: IApi;
}) {
  let { config } = opts;

  const {
    api,
    resolvePaths = api.service.configManager!.files.map((f) => path.dirname(f)),
  } = opts;

  if (config.extends) {
    let absExtendsPath = "";
    const configManager = api.service.configManager!
      .constructor as typeof Config;

    // try to resolve extends path
    resolvePaths.some((dir) => {
      try {
        absExtendsPath = resolve.sync(config.extends, {
          basedir: dir,
          extensions: [".js", ".ts"],
        });
        return true;
      } catch {}
    });

    if (!absExtendsPath) {
      throw new Error(`Cannot find extends config file: ${config.extends}`);
    } else if (api.service.configManager!.files.includes(absExtendsPath)) {
      throw new Error(
        `Cannot extends config circularly for file: ${absExtendsPath}`
      );
    }
    // load extends config
    const { config: extendsConfig, files: extendsFiles } =
      configManager.getUserConfig({ configFiles: [absExtendsPath] });

    configManager.validateConfig({
      config: extendsConfig,
      schemas: api.service.configSchemas,
    });

    // try to parse nested extends config
    const nestedConfig = parseExtendsConfig({
      config: extendsConfig,
      resolvePaths: [path.dirname(absExtendsPath)],
      api,
    });

    // merge extends config & save related files
    config = deepmerge(nestedConfig, config);
    api.service.configManager!.files.push(...extendsFiles);
  }

  return config;
}
