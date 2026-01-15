import React, { useEffect, useState, useRef } from 'react';
import './App.css';

// Decode interview token to extract payload
function decodeInterviewToken(token: string) {
  try {

    const [payloadBase64] = token.split('.');
    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);
    return {
      candidateId: payload.candidate_id,
      email: payload.email,
      name: payload.name,
      shareKey: payload.shareKey,
      exp: payload.exp
    };
  } catch (error) {
    console.error('Failed to decode interview token:', error);
    return null;
  }
}

export default function App() {
  const [interviewToken, setInterviewToken] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const timerRef = useRef<number | null>(null);
  const vapiRef = useRef<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('interviewToken');

    if (!token) {
      alert('Invalid interview link');
      return;
    }

    setInterviewToken(token);

    // Decode token to extract candidate name
    const decoded = decodeInterviewToken(token);
    if (decoded) {
      setCandidateName(decoded.name);
      console.log('Decoded token:', decoded);
    }

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // start/stop timer when status changes
    if (status === 'live') {
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [status]);

  const endCall = async () => {
    try {
      if (vapiRef.current) {
        if (typeof vapiRef.current.end === 'function') {
          await vapiRef.current.end();
        } else if (typeof vapiRef.current.stop === 'function') {
          await vapiRef.current.stop();
        } else if (vapiRef.current.activeCall && typeof vapiRef.current.activeCall.hangup === 'function') {
          await vapiRef.current.activeCall.hangup();
        } else if (vapiRef.current.currentCall && typeof vapiRef.current.currentCall.hangup === 'function') {
          await vapiRef.current.currentCall.hangup();
        } else if (vapiRef.current.calls && typeof vapiRef.current.calls.end === 'function') {
          // best-effort: end the first known call
          const keys = Object.keys(vapiRef.current.calls || {});
          if (keys.length) {
            await vapiRef.current.calls.end(keys[0]);
          }
        } else {
          console.warn('No supported shutdown method found on VAPI instance');
        }
      }
    } catch (e) {
      console.error('Error while attempting to end VAPI call', e);
    } finally {
      setStatus('idle');
      setSeconds(0);
      setIsSpeaking(false);
      setMicOn(true);
    }
  };

  useEffect(() => {
    // expose helpers for debugging in the browser console
    const w = window as any;
    w.__vapiRef = vapiRef;
    w.startVapi = startVapi;
    return () => {
      delete w.__vapiRef;
      delete w.startVapi;
    };
  }, []);

  useEffect(() => {
    if (process.env.REACT_APP_VAPI_AUTO_START === 'true') {
      // auto-start VAPI if configured in env
      startVapi();
    }
  }, []);

  const toggleMic = () => {
    const newMicState = !micOn;
    setMicOn(newMicState);

    // Actually mute/unmute the VAPI microphone
    if (vapiRef.current && typeof vapiRef.current.setMuted === 'function') {
      vapiRef.current.setMuted(!newMicState);
    }
  };

  const startVapi = async () => {
    if (!interviewToken) {
      alert('Invalid interview link');
      return;
    }

    setStatus('connecting');
    setSeconds(0);
    const params = new URLSearchParams(window.location.search);

    const assistantId =
      params.get('assistantId') ||
      params.get('assistant_id') ||
      process.env.REACT_APP_VAPI_ASSISTANT_ID;

    const key = process.env.REACT_APP_VAPI_KEY;

    if (!key) {
      alert('VAPI API key is missing. Please configure REACT_APP_VAPI_KEY in your .env file.');
      setStatus('idle');
      return;
    }

    if (!assistantId) {
      alert('VAPI Assistant ID is missing. Please configure REACT_APP_VAPI_ASSISTANT_ID in your .env file or pass it as a URL parameter.');
      setStatus('idle');
      return;
    }

    const container = document.getElementById('vapiContainer');
    console.log('startVapi() called', { assistantId, containerPresent: !!container });

    try {
      const mod = await import('@vapi-ai/web');
      const Vapi = (mod && (mod.default || mod));

      // Clean up any existing instance
      if (vapiRef.current) {
        try {
          await vapiRef.current.stop?.();
        } catch (e) {
          console.warn('Failed to stop existing VAPI instance', e);
        }
      }

      vapiRef.current = new Vapi(key);

      vapiRef.current.on?.('call-start', () => {
        console.log('VAPI call-start event fired');
        setStatus('live');
      });

      vapiRef.current.on?.('call-end', () => {
        console.log('VAPI call-end event fired');
        setStatus('ended');
        setTimeout(() => {
          setStatus('idle');
          setSeconds(0);
          setIsSpeaking(false);
          setMicOn(true);
        }, 1000);
      });

      vapiRef.current.on?.('error', (error: any) => {
        console.error('VAPI error:', error);
        setStatus('idle');
        setSeconds(0);
      });

      vapiRef.current.on?.('speech-start', () => {
        console.log('Speech started');
        setIsSpeaking(true);
      });

      vapiRef.current.on?.('speech-end', () => {
        console.log('Speech ended');
        setIsSpeaking(false);
      });

      vapiRef.current.on?.('message', (msg: any) => {
        if (msg.type === 'transcript') {
          console.log(msg.role, msg.transcript);
        }
      });

      if (container && typeof vapiRef.current.mount === 'function') {
        try {
          vapiRef.current.mount(container);
        } catch (err) {
          console.warn('VAPI mount failed', err);
        }
      }

      // Build start options with interview token
      const startOptions: any = {
        metadata: {
          interviewToken,
          source: 'qweb-interview'
        },

        variableValues: {
          candidateName: candidateName || 'Unknown',
          interviewToken
        }
      };

      console.log('Starting VAPI with candidate:', candidateName);
      console.log('Starting VAPI with options:', startOptions);

      // ✅ START CALL - simplified to avoid 400 errors
      await vapiRef.current.start(assistantId, startOptions);

      vapiRef.current.on('call-start', (payload: any) => {
        console.log('CALL START PAYLOAD:', payload);
      });


      console.log('VAPI started successfully');
    } catch (err) {
      console.error('Failed to start VAPI', err);
      setStatus('idle');
      setSeconds(0);
      // Show user-friendly error
      alert('Failed to start the interview. Please check your connection and try again.');
    }
  };

  const toggleSpeaker = () => {
    setSpeakerOn((v) => !v);
  };

  const formatTime = (s: number) => {
    const mm = Math.floor(s / 60)
      .toString()
      .padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  return (
    <div className="app-container">
      {/* Call Card */}
      <div className="call-card">
        <div className="card-accent" aria-hidden="true"></div>

        {/* Welcome Header */}
        {status !== 'live' && (
          <div className="welcome-header">
            <p className="text-sm">Hi {candidateName || 'there'}, great to have you here! Start the conversation by clicking the button and chat comfortably with our AI assistant.</p>
          </div>
        )}

        {/* Header - Status and Timer */}
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm font-medium text-slate-700">
            {formatTime(seconds)}
          </div>
          <div
            className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full ${status === 'live' ? 'status-badge-live' :
              status === 'connecting' ? 'status-badge-connecting' :
                'status-badge-idle'
              }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${status === 'live' ? 'bg-green-400 pulse' :
                status === 'connecting' ? 'bg-yellow-400 pulse' :
                  'bg-slate-300'
                }`}
            ></span>
            <span className="font-medium">
              {status === 'connecting' ? 'Connecting...' :
                status === 'live' ? 'Live' :
                  status === 'idle' ? 'Ready' :
                    'Ended'}
            </span>
          </div>
        </div>

        {/* Main Circle Avatar - Center Stage */}
        <div className="flex flex-col items-center justify-center">
          <div className={`call-circle ${isSpeaking ? 'speaking' : ''} ${status === 'live' ? 'active' : ''}`}>
            <div className="call-circle-inner">
              {/* Animated Wave Bars */}
              <div className="circle-waves">
                <span className="wave-bar"></span>

                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
                <span className="wave-bar"></span>
              </div>
            </div>
          </div>

          {/* Info Text Below Circle */}
          <div className="mt-4 text-center">
            <div className="text-sm text-slate-700 font-medium">AI Interviewer</div>
            <div className="text-xs text-slate-400 mt-1">Supply Chain Manager</div>
          </div>

          {/* Controls Container - Always below circle and info */}
          <div className="mt-6 flex items-center justify-center gap-4">
            {/* Start Button - Only visible when idle */}
            {status === 'idle' && (
              <button
                onClick={startVapi}
                className="start-call-btn"
                aria-label="Start Interview"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>
            )}

            {/* Call Controls - Show when connecting or live */}
            {(status === 'connecting' || status === 'live') && (
              <>
                {/* Mic Toggle */}
                <button
                  onClick={toggleMic}
                  className={`control-btn-round ${!micOn ? 'muted' : ''}`}
                  aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  title={micOn ? 'Mute' : 'Unmute'}
                >
                  {micOn ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 2a2 2 0 0 0-2 2v6a2 2 0 1 0 4 0V4a2 2 0 0 0-2-2z" />
                      <path d="M5 10a5 5 0 0 0 10 0h-1a4 4 0 1 1-8 0H5z" />
                      <path d="M10 15v3" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 9V5a3 3 0 10-6 0v4M5 10v1a7 7 0 0014 0v-1M3 3l18 18" />
                    </svg>
                  )}
                </button>

                {/* End Call Button */}
                <button
                  onClick={endCall}
                  className="end-call-btn"
                  aria-label="End call"
                  title="End Interview"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.11-.27 11.36 11.36 0 003.48.56 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.56 3.48 1 1 0 01-.27 1.11l-2.17 2.2z" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="footer-text">
          <svg className="w-3.5 h-3.5 inline-block mr-1.5 opacity-50" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          This interview may be recorded for quality purposes
        </div>

        {/* Hidden VAPI Container */}
        <div id="vapiContainer" className="hidden"></div>
      </div>
    </div>
  );
}

(() => {
  const _fetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await _fetch(...args);
    try {
      const url = (args[0] && args[0].toString()) || '';
      if (url.includes('/call/web')) {
        res.clone().text().then(body => console.log('CALL/WEB response', res.status, body)).catch(() => { });
      }
    } catch (e) { console.warn('fetch-logger error', e); }
    return res;
  };
})();
