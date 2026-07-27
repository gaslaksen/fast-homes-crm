import { Test } from '@nestjs/testing';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { TwilioVoiceService } from './twilio-voice.service';

/**
 * The wait audio has now been wrong twice: first hold music, then a single
 * play that fell silent after one ring. Both were invisible until someone
 * placed a real call, so the exact TwiML is asserted here.
 */
describe('conference wait TwiML', () => {
  let controller: CallsController;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [CallsController],
      providers: [
        { provide: CallsService, useValue: {} },
        {
          provide: TwilioVoiceService,
          useValue: { ringbackAudioUrl: () => 'https://api.test/calls/twilio/ringback.wav' },
        },
      ],
    }).compile();
    controller = mod.get(CallsController);
  });

  const render = () => {
    let body = '';
    const headers: Record<string, string> = {};
    const res: any = {
      set: (k: string, v: string) => { headers[k] = v; return res; },
      send: (b: string) => { body = b; return res; },
    };
    controller.ringbackTwiml(res);
    return { body, headers };
  };

  it('serves XML', () => {
    expect(render().headers['Content-Type']).toBe('text/xml');
  });

  it('loops forever, which is what loop="0" means', () => {
    // Without this the tone plays once and the agent hears silence until answer.
    expect(render().body).toContain('loop="0"');
  });

  it('points at the generated tone', () => {
    expect(render().body).toContain('https://api.test/calls/twilio/ringback.wav');
  });

  it('is well-formed TwiML', () => {
    expect(render().body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Play loop="0">https://api.test/calls/twilio/ringback.wav</Play></Response>',
    );
  });
});
