import { useRouter } from 'next/router';
import { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import ReactPlayer from 'react-player';
import Peer from 'peerjs';
import Draggable from 'react-draggable';

export default function Room() {
  const router = useRouter();
  const { id } = router.query;
  const [socket, setSocket] = useState(null);
  const [users, setUsers] = useState([]);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [myStream, setMyStream] = useState(null);
  const [peer, setPeer] = useState(null);
  const [peerId, setPeerId] = useState(null); // store peer ID separately
  const [remoteStreams, setRemoteStreams] = useState({});
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('media');
  const [isPeerReady, setIsPeerReady] = useState(false);
  const playerRef = useRef(null);
  const myVideoRef = useRef(null);
  const userIdRef = useRef(Math.random().toString(36).substring(2, 8));

  // Logging utility
  const log = useCallback((...args) => {
    console.log(`[${userIdRef.current}]`, ...args);
  }, []);

  // Connect to Socket.io
  useEffect(() => {
    if (!id) return;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      setError('Backend URL not configured');
      return;
    }
    log('Connecting to backend:', backendUrl);
    const socket = io(backendUrl);
    setSocket(socket);

    socket.on('connect', () => log('Socket connected'));
    socket.on('room-state', (state) => {
      log('Room state:', state);
      setMediaUrl(state.mediaUrl || null);
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
    });
    socket.on('existing-users', (existing) => {
      log('Existing users:', existing);
      setUsers(existing);
    });
    socket.on('user-joined', (user) => {
      log('User joined:', user);
      setUsers(prev => [...prev, user]);
    });
    socket.on('user-left', (userId) => {
      log('User left:', userId);
      setUsers(prev => prev.filter(u => u.userId !== userId));
    });
    socket.on('sync', (state) => {
      log('Sync:', state);
      setMediaUrl(state.mediaUrl || null);
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
      if (playerRef.current && state.mediaUrl) {
        playerRef.current.seekTo(state.currentTime, 'seconds');
      }
    });
    socket.on('signal', ({ fromPeerId, signal }) => {
      log('Signal from:', fromPeerId, signal);
      if (peer && myStream && isPeerReady) {
        try {
          const call = peer.call(fromPeerId, myStream);
          call.on('stream', (remoteStream) => {
            log('Received stream from', fromPeerId);
            setRemoteStreams(prev => ({ ...prev, [fromPeerId]: remoteStream }));
          });
        } catch (err) {
          log('Error answering call:', err);
        }
      }
    });
    socket.on('connect_error', (err) => {
      log('Socket error:', err);
      setError('Failed to connect to server');
    });

    return () => {
      log('Disconnecting socket');
      socket.disconnect();
    };
  }, [id, log, peer, myStream, isPeerReady]);

  // Set up PeerJS
  useEffect(() => {
    if (!socket) return;
    log('Initializing PeerJS');
    const peer = new Peer();
    setPeer(peer);

    peer.on('open', (id) => {
      log('PeerJS open with ID:', id);
      setPeerId(id);
      setIsPeerReady(true);
      // Join the room with our peerId
      socket.emit('join-room', {
        roomId: id,
        userId: userIdRef.current,
        peerId: id
      });
    });

    peer.on('call', (call) => {
      log('Incoming call from:', call.peer);
      if (myStream) {
        call.answer(myStream);
        call.on('stream', (remoteStream) => {
          log('Stream received from', call.peer);
          setRemoteStreams(prev => ({ ...prev, [call.peer]: remoteStream }));
        });
      } else {
        log('No local stream to answer call');
      }
    });

    peer.on('error', (err) => {
      log('PeerJS error:', err);
      setError('WebRTC error: ' + err.type);
    });

    return () => {
      log('Destroying peer');
      peer.destroy();
      setIsPeerReady(false);
    };
  }, [socket, myStream, log]);

  // Get user media
  useEffect(() => {
    log('Requesting camera/mic permissions');
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        log('Got local stream');
        setMyStream(stream);
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = stream;
        }
      })
      .catch(err => {
        log('Media error:', err);
        setError('Camera/mic permission denied or not available');
      });
  }, [log]);

  // Call new users when they join (only when peer is ready and we have stream)
  useEffect(() => {
    if (!isPeerReady || !myStream || !peerId) {
      log('Not ready to call: peerReady=%s, hasStream=%s, peerId=%s', isPeerReady, !!myStream, peerId);
      return;
    }
    users.forEach(user => {
      if (!user.peerId) {
        log('User has no peerId:', user);
        return;
      }
      if (user.peerId === peerId) {
        log('Skipping self:', user.peerId);
        return;
      }
      if (remoteStreams[user.peerId]) {
        // Already have stream from this user
        return;
      }
      log('Calling user:', user.peerId);
      try {
        const call = peer.call(user.peerId, myStream);
        call.on('stream', (remoteStream) => {
          log('Stream from', user.peerId, 'received');
          setRemoteStreams(prev => ({ ...prev, [user.peerId]: remoteStream }));
        });
        call.on('error', (err) => {
          log('Call error with', user.peerId, err);
        });
      } catch (err) {
        log('Exception during call:', err);
      }
    });
  }, [users, isPeerReady, myStream, peerId, peer, remoteStreams, log]);

  // Player actions
  const handlePlay = () => {
    setIsPlaying(true);
    socket?.emit('action', { type: 'play', seconds: playerRef.current?.getCurrentTime() });
  };

  const handlePause = () => {
    setIsPlaying(false);
    socket?.emit('action', { type: 'pause', seconds: playerRef.current?.getCurrentTime() });
  };

  const handleSeek = (seconds) => {
    socket?.emit('action', { type: 'seek', seconds });
  };

  const handleAddMedia = (url) => {
    setMediaUrl(url);
    socket?.emit('action', { type: 'media', url });
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Link copied!');
  };

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="bg-red-900 p-6 rounded-lg max-w-md">
          <h2 className="text-xl font-bold mb-4">Error</h2>
          <p>{error}</p>
          <button onClick={() => router.push('/')} className="mt-4 bg-blue-600 px-4 py-2 rounded">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Top bar */}
      <div className="bg-gray-800 p-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold">Sync Stream</h1>
          <div className="bg-gray-700 px-3 py-1 rounded text-sm">Room: {id}</div>
          <button onClick={copyRoomLink} className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm">
            Copy Invite Link
          </button>
        </div>
        <div className="text-sm text-gray-300">{users.length + 1} online</div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video area */}
        <div className="flex-1 relative bg-black flex items-center justify-center">
          {!mediaUrl ? (
            <div className="text-center text-gray-400">
              <p className="text-lg">No media loaded</p>
              <p className="text-sm mt-2">Add a YouTube link or video URL from the sidebar</p>
            </div>
          ) : (
            <>
              <ReactPlayer
                ref={playerRef}
                url={mediaUrl}
                playing={isPlaying}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
                onBuffer={() => setBuffering(true)}
                onBufferEnd={() => setBuffering(false)}
                onError={(e) => setError('Failed to load media')}
                width="100%"
                height="100%"
                style={{ position: 'absolute', top: 0, left: 0 }}
                config={{
                  youtube: {
                    playerVars: { modestbranding: 1 }
                  }
                }}
              />
              {buffering && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                </div>
              )}
            </>
          )}

          {/* Floating video tiles */}
          <div className="absolute top-4 right-4 space-y-2 pointer-events-none z-10">
            {Object.entries(remoteStreams).map(([peerId, stream]) => (
              <Draggable key={peerId} bounds="parent">
                <div className="pointer-events-auto w-48 h-36 bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-move border-2 border-blue-500">
                  <video
                    ref={el => { if (el) el.srcObject = stream; }}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
              </Draggable>
            ))}
            {myStream && (
              <Draggable bounds="parent">
                <div className="pointer-events-auto w-48 h-36 bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-move border-2 border-green-500">
                  <video
                    ref={myVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                </div>
              </Draggable>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-80 bg-gray-800 flex flex-col border-l border-gray-700">
          {/* Tab headers */}
          <div className="flex border-b border-gray-700">
            <button onClick={() => setActiveTab('media')} className={`flex-1 py-3 text-sm font-medium ${activeTab === 'media' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Media</button>
            <button onClick={() => setActiveTab('users')} className={`flex-1 py-3 text-sm font-medium ${activeTab === 'users' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Users ({users.length + 1})</button>
            <button onClick={() => setActiveTab('settings')} className={`flex-1 py-3 text-sm font-medium ${activeTab === 'settings' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Settings</button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'media' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">YouTube / Video URL</label>
                  <input
                    type="text"
                    placeholder="Paste link and press Enter"
                    className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target.value) {
                        handleAddMedia(e.target.value);
                        e.target.value = '';
                      }
                    }}
                  />
                </div>
                <div>
                  <button
                    onClick={() => handleAddMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}
                    className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm"
                  >
                    🎵 Play Rick Roll (demo)
                  </button>
                </div>
                <div>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.mediaDevices.getDisplayMedia({ video: true });
                        alert('Screenshare started (simplified demo)');
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                    className="w-full bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded text-sm"
                  >
                    🖥️ Start Screenshare (creator only)
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div>
                <h3 className="font-semibold mb-2">In Room</h3>
                <ul className="space-y-2">
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                    You ({userIdRef.current})
                  </li>
                  {users.map(user => (
                    <li key={user.userId} className="flex items-center">
                      <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                      {user.userId}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-3">
                <div>
                  <label className="flex items-center"><input type="checkbox" className="mr-2" /> Mute all</label>
                </div>
                <div>
                  <label className="flex items-center"><input type="checkbox" className="mr-2" /> Hide self view</label>
                </div>
                <div className="text-sm text-gray-400">More options coming soon...</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
