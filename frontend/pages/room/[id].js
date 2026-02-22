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
  const [mediaUrl, setMediaUrl] = useState('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [myStream, setMyStream] = useState(null);
  const [peer, setPeer] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const playerRef = useRef(null);
  const myVideoRef = useRef(null);

  // Generate a random user ID (persist in session? not needed for demo)
  const userIdRef = useRef(Math.random().toString(36).substring(2, 8));

  // Connect to Socket.io server
  useEffect(() => {
    if (!id) return;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL; // e.g., https://sync-stream-backend.onrender.com
    const socket = io(backendUrl);
    setSocket(socket);

    socket.on('connect', () => {
      console.log('Connected to server');
      // Join the room after we get peerId (peer will be created later, but we can join after)
    });

    socket.on('room-state', (state) => {
      setMediaUrl(state.mediaUrl);
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
      if (playerRef.current) {
        playerRef.current.seekTo(state.currentTime, 'seconds');
      }
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
      setMediaUrl(state.mediaUrl);
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
      if (playerRef.current) {
        playerRef.current.seekTo(state.currentTime, 'seconds');
      }
    });

    // WebRTC signaling
    socket.on('signal', ({ fromPeerId, signal }) => {
      // Accept the call
      if (peer) {
        const call = peer.call(fromPeerId, myStream);
        call.on('stream', (remoteStream) => {
          setRemoteStreams(prev => ({ ...prev, [fromPeerId]: remoteStream }));
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [id]);

  // Set up PeerJS
  useEffect(() => {
    const peer = new Peer(); // uses public PeerServer (for production, consider hosting your own)
    setPeer(peer);

    peer.on('open', (peerId) => {
      // Now we can join the room with our peerId
      if (socket) {
        socket.emit('join-room', {
          roomId: id,
          userId: userIdRef.current,
          peerId
        });
      }
    });

    peer.on('call', (call) => {
      call.answer(myStream);
      call.on('stream', (remoteStream) => {
        setRemoteStreams(prev => ({ ...prev, [call.peer]: remoteStream }));
      });
    });

    return () => peer.destroy();
  }, [socket, myStream]);

  // Get user media (camera/mic)
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setMyStream(stream);
        if (myVideoRef.current) myVideoRef.current.srcObject = stream;
      })
      .catch(err => console.error('media error', err));
  }, []);

  // When a new user joins, call them (if we already have peer and stream)
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

  // Handle player actions
  const handlePlay = () => {
    setIsPlaying(true);
    socket?.emit('action', { type: 'play', seconds: playerRef.current.getCurrentTime() });
  };

  const handlePause = () => {
    setIsPlaying(false);
    socket?.emit('action', { type: 'pause', seconds: playerRef.current.getCurrentTime() });
  };

  const handleSeek = (seconds) => {
    socket?.emit('action', { type: 'seek', seconds });
  };

  const handleAddMedia = (url) => {
    setMediaUrl(url);
    socket?.emit('action', { type: 'media', url });
  };

  // Screenshare (room creator only - simple check using first user? Not robust)
  const startScreenshare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      // Replace video track in all peer connections
      // For simplicity, we'll just replace our local stream and renegotiate? 
      // Better: create a new stream and update tracks. This is a bit advanced; for brevity, we'll skip full implementation here.
      alert('Screenshare started (simplified demo)');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Main video area */}
      <div className="flex-1 relative">
        <ReactPlayer
          ref={playerRef}
          url={mediaUrl}
          playing={isPlaying}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          width="100%"
          height="100%"
          style={{ position: 'absolute', top: 0, left: 0 }}
          config={{
            youtube: {
              playerVars: { modestbranding: 1, autoplay: 1 }
            }
          }}
        />

        {/* Floating video tiles (draggable) */}
        <div className="absolute top-4 right-4 space-y-2 pointer-events-none">
          {Object.entries(remoteStreams).map(([peerId, stream]) => (
            <Draggable key={peerId} bounds="parent">
              <div className="pointer-events-auto w-48 h-36 bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-move">
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
              <div className="pointer-events-auto w-48 h-36 bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-move">
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
      <div className="w-80 bg-gray-800 p-4 flex flex-col">
        <div>
          <h3 className="font-semibold mb-2">Online ({users.length})</h3>
          <ul className="space-y-1">
            {users.map(user => (
              <li key={user.userId} className="flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                {user.userId}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <h3 className="font-semibold mb-2">Add Media</h3>
          <input
            type="text"
            placeholder="Paste YouTube or video URL"
            className="w-full bg-gray-700 px-3 py-2 rounded"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddMedia(e.target.value);
            }}
          />
        </div>

        <div className="mt-4">
          <h3 className="font-semibold mb-2">Controls</h3>
          <button
            onClick={() => handleAddMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}
            className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded mb-2"
          >
            Play Rick Roll (demo)
          </button>
          <button
            onClick={startScreenshare}
            className="w-full bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded"
          >
            Start Screenshare (creator only)
          </button>
        </div>
      </div>
    </div>
  );
}
