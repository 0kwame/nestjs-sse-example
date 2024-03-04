import {
  Controller,
  Get,
  InternalServerErrorException,
  MessageEvent,
  Param,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import { Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  firstValueFrom,
  interval,
  lastValueFrom,
  Observable,
  of,
  pipe,
  Subject,
} from 'rxjs';
import { map } from 'rxjs/operators';
import { Cron, CronExpression } from '@nestjs/schedule';

@Controller()
export class AppController {
  /** List of connected clients */
  connectedClients = new Map<
    string,
    { close: () => void; subject: Subject<MessageEvent> }
  >();

  @Get()
  index(@Res() response: Response) {
    response
      .type('text/html')
      .send(readFileSync(join(__dirname, 'index.html')).toString());
  }

  @Get('/sse')
  async example(@Res() response: Response) {
    const validationFailed = false;

    /* Make some validation */
    if (validationFailed)
      throw new InternalServerErrorException({
        message: 'Query failed',
        error: 100,
        status: 500,
      });

    // Create a subject for this client in which we'll push our data
    const subject = new Subject<MessageEvent>();

    // Create an observer that will take the data pushed to the subject and
    // write it to our connection stream in the right format
    const observer = {
      next: (msg: MessageEvent) => {
        // Called when data is pushed to the subject using subject.next()
        // Encode the message as SSE (see https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events)

        // Here's an example of what it could look like, assuming msg.data is an object
        // If msg.data is not an object, you should adjust accordingly

        if (msg.type) response.write(`event: ${msg.type}\n`);
        if (msg.id) response.write(`id: ${msg.id}\n`);
        if (msg.retry) response.write(`retry: ${msg.retry}\n`);

        response.write(`data: ${JSON.stringify(msg.data)}\n\n`);
      },
      complete: () => {
        console.log(`observer.complete`);
      },
      error: (err: any) => {
        console.log(`observer.error: ${err}`);
      },
    };

    // Attach the observer to the subject
    subject.subscribe(observer);

    // Add the client to our client list
    const clientId = String(Math.floor(Math.random() * 2) + 1); // Extract the user id from the request bearer token

    console.log('connected client id:', clientId);

    const clientKey = clientId; // String that identifies your client
    this.connectedClients.set(clientKey, {
      close: () => {
        response.end();
      }, // Will allow us to close the connection if needed
      subject, // Subject related to this client
    });

    // Handle connection closed
    response.on('close', () => {
      console.log(`Closing connection for client ${clientKey}`);
      subject.complete(); // End the observable stream
      this.connectedClients.delete(clientKey); // Remove client from the list
      response.end(); // Close connection (unsure if this is really requried, to release the resources)
    });

    // Send headers to establish SSE connection
    response.set({
      'Cache-Control':
        'private, no-cache, no-store, must-revalidate, max-age=0, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });

    response.flushHeaders();

    // From this point, the connection with the client is established.
    // We can send data using the subject.next(MessageEvent) function.
    // See the sendDataToClient() function below.
  }

  /** Send a SSE message to the specified client */
  sendDataToClient(clientId: string, message: MessageEvent) {
    console.log('send data to client: ', clientId);

    this.connectedClients.get(clientId)?.subject.next(message);
  }

  /** Simulates sending data to a specific client */
  @Cron('*/5 * * * * *')
  handleEvery10Minutes() {
    console.log('cron run');
    const message: MessageEvent = {
      type: 'ping',
      id: String(Math.floor(Math.random() * 1000) + 1),
      data: {
        user: 1,
        message: String(Math.floor(Math.random() * 1000000) + 1),
      },
    };

    this.sendDataToClient('1', message);
  }
}
