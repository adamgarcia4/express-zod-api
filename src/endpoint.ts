import * as z from 'zod';
import {JoinUnshaped, Unshape} from './helpers';
import {logger} from './logger';
import {Request, Response} from 'express';
import {MiddlewareDefinition} from './middleware';
import {defaultResultHandler, ResultHandler} from './result-handler';

export type Handler<IN, OUT, OPT> = (params: {
  input: IN,
  options: OPT
}) => Promise<OUT>;

export abstract class AbstractEndpoint {
  protected method: Method;
  public abstract execute(request: Request, response: Response): Promise<void>;
  public getMethod() {
    return this.method;
  }
}

export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch';

/** mIN, OPT - from Middlewares */
export class Endpoint<IN extends z.ZodRawShape, OUT extends z.ZodRawShape, mIN, OPT> extends AbstractEndpoint {
  protected middlewares: MiddlewareDefinition<any, any, any>[] = [];
  protected inputSchema: z.ZodObject<IN>;
  protected outputSchema: z.ZodObject<OUT>;
  protected handler: Handler<JoinUnshaped<IN, mIN>, Unshape<OUT>, OPT>
  protected resultHandler: ResultHandler;

  constructor({method, middlewares, inputSchema, outputSchema, handler, resultHandler}: {
    method: Method;
    middlewares: MiddlewareDefinition<any, any, any>[],
    inputSchema: z.ZodObject<IN>,
    outputSchema: z.ZodObject<OUT>,
    handler: Handler<JoinUnshaped<IN, mIN>, Unshape<OUT>, OPT>
    resultHandler: ResultHandler | null
  }) {
    super();
    this.method = method;
    this.middlewares = middlewares;
    this.inputSchema = inputSchema;
    this.outputSchema = outputSchema;
    this.handler = handler;
    this.resultHandler = resultHandler || defaultResultHandler;
  }

  public async execute(request: Request, response: Response) {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'content-type');

    if (request.method === 'OPTIONS') {
      response.end();
      return;
    }

    let error;
    let output;
    let initialInput: any = null;
    try {
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        initialInput = request.body;
      }
      if (request.method === 'GET') {
        initialInput = request.query
      }
      if (request.method === 'DELETE') {
        initialInput = {...request.query, ...request.body};
      }
      let input = {...initialInput};
      let options: any = {};
      for (let def of this.middlewares) {
        input = {...input, ...def.input.parse(input)}; // middleware can transform the input types
        Object.assign(options, await def.middleware({
          input,
          options,
          request,
          response,
        }));
        if (response.writableEnded) {
          return;
        }
      }
      input = this.inputSchema.parse(input); // final input types transformations for handler
      output = await this.handler({
        input,
        options,
      });
    } catch (e) {
      error = e;
    }
    try {
      await this.resultHandler({error, input: initialInput, output, request, response});
    } catch (e) {
      logger.error(`Result handler failure: ${e.message}.`);
      // throw e;
    }
  }
}

