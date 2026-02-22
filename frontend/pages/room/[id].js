import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import ReactPlayer from 'react-player';
import Peer from 'peerjs';
import Draggable from 'react-draggable';

export default function Room() {
  const router = useRouter();
  const { id } = router.query;
  const [socket, setSocket] = useState(null);
  const [users, setUsers] = useState([]);
  const [mediaUrl, setMediaUrl] = useState(null); // No default – starts empty
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [myStream, setMyStream] = useState(null);
  const [peer, setPeer] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('media');
  const playerRef = useRef(null);
  const myVideoRef = useRef(null);
  const userIdRef = useRef(Math.random().toString(36).substring(2, 8));

  // Connect to Socket.io
  useEffect(() => {
    if (!id) return;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      setError('Backend URL not configured');
      return;
    }
    const socket = io(backendUrl);
    setSocket(socket);

    socket.on('connect', () => {
      console.log('Socket connected');
    });

    socket.on('room-state', (state) => {
      console.log('Room state:', state);
      // Only set mediaUrl if it's not null/empty
      setMediaUrl(state.mediaUrl || null);
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
    });

    socket.on('existing-users', (existing) => {
      setUsers(existing);
    });

    socket.on('user-joined', (user) => {
      setUsers(prev => [...prev, user]);
    });

    socket.on('user-left', (userId) => {
      setUsers(prev => prev.filter(u => u.userId !== userId));
    });

    socket.on('sync', (state) => {
      console.log('Sync:', state);
      setMediaUrl(state.mediaUrl || null);
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
      if (playerRef.current && state.mediaUrl) {
        playerRef.current.seekTo(state.currentTime, 'seconds');
      }
    });

    socket.on('signal', ({ fromPeerId, signal }) => {
      if (peer) {
        peer.call(fromPeerId, myStream);
      }
    });

    socket.on('connect_error', (err) => {
      console.error('Socket error:', err);
      setError('Failed to connect to server');
    });

    return () => socket.disconnect();
  }, [id]);

  // Set up PeerJS
  useEffect(() => {
    if (!socket) return;
    const peer = new Peer();
    setPeer(peer);

    peer.on('open', (peerId) => {
      socket.emit('join-room', {
        roomId: id,
        userId: userIdRef.current,
        peerId
      });
    });

    peer.on('call', (call) => {
      if (myStream) {
        call.answer(myStream);
        call.on('stream', (remoteStream) => {
          setRemoteStreams(prev => ({ ...prev, [call.peer]: remoteStream }));
        });
      }
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setError('WebRTC error: ' + err.type);
    });

    return () => peer.destroy();
  }, [socket, myStream]);

  // Get user media
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setMyStream(stream);
        if (myVideoRef.current) myVideoRef.current.srcObject = stream;
      })
      .catch(err => {
        console.error('Media error:', err);
        setError('Camera/mic permission denied');
      });
  }, []);

  // Call new users
  useEffect(() => {
    if (!peer || !myStream) return;
    users.forEach(user => {
      if (user.peerId && !remoteStreams[user.peerId] && user.peerId !== peer.id) {
        const call = peer.call(user.peerId, myStream);
        call.on('stream', (remoteStream) => {
          setRemoteStreams(prev => ({ ...prev, [user.peerId]: remoteStream }));
        });
      }
    });
  }, [users, peer, myStream, remoteStreams]);

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
                    playerVars: { modestbranding: 1 } // removed autoplay
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
                  <video ref={el => { if (el) el.srcObject = stream; }} autoPlay playsInline className="w-full h-full object-cover" />
                </div>
              </Draggable>
            ))}
            {myStream && (
              <Draggable bounds="parent">
                <div className="pointer-events-auto w-48 h-36 bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-move border-2 border-green-500">
                  <video ref={myVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
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
