const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const path = require('path');

app.use(express.static(__dirname));

const rooms = {};

const people = [
            { avatar: 'images/1.png', age: 57, race: 'Ази', gender: 'Эрэгтэй' },
            { avatar: 'images/2.png', age: 79, race: 'Цагаан', gender: 'Эрэгтэй' },
            { avatar: 'images/3.png', age: 30, race: 'Латин', gender: 'Эмэгтэй' },
            { avatar: 'images/4.png', age: 40, race: 'Латин', gender: 'Эрэгтэй' },
            { avatar: 'images/5.png', age: 23, race: 'Цагаан', gender: 'Эмэгтэй' },
            { avatar: 'images/6.png', age: 60, race: 'Цагаан', gender: 'Эрэгтэй' },
            { avatar: 'images/7.png', age: 25, race: 'Хар', gender: 'Эмэгтэй' },
            { avatar: 'images/8.png', age: 30, race: 'Латин', gender: 'Эмэгтэй' },
            { avatar: 'images/9.png', age: 23, race: 'Хар', gender: 'Эрэгтэй' },
            { avatar: 'images/10.png', age: 30, race: 'Ази', gender: 'Эрэгтэй' }
        ];

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms[code]);
  return code;
}

function calculatePoints(guess, actual) {
  let points = 0;
  let feedback = [];

  const ageDiff = Math.abs(guess.age - actual.age);
  if (ageDiff === 0) {
    points += 3;
    feedback.push(`✅ Нас яг зөв! (${actual.age})`);
  } else if (ageDiff <= 3) {
    points += 2;
    feedback.push(`✅ Нас ойрхон! (${actual.age})`);
  } else if (ageDiff <= 5) {
    points += 1;
    feedback.push(`⚠️ Нас бага зэрэг ойрхон (${actual.age})`);
  } else {
    feedback.push(`❌ Нас буруу (${actual.age})`);
  }

  if (guess.race === actual.race) {
    points += 1;
    feedback.push(`✅ Үндэс зөв!`);
  } else {
    feedback.push(`❌ Үндэс буруу (${actual.race})`);
  }

  if (guess.gender === actual.gender) {
    points += 1;
    feedback.push(`✅ Хүйс зөв!`);
  } else {
    feedback.push(`❌ Хүйс буруу (${actual.gender})`);
  }

  return { points, feedback };
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createGame', ({ hostName }) => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      hostId: socket.id,
      hostName: hostName,
      players: [],
      started: false,
      currentQuestion: 0,
      submissions: []
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isHost = true;
    socket.playerName = hostName;

    socket.emit('gameCreated', { roomCode });
    console.log(`Room ${roomCode} created by ${hostName}`);
  });

  socket.on('joinGame', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit('error', { message: 'Өрөө олдсонгүй!' });
      return;
    }

    if (room.started) {
      socket.emit('error', { message: 'Тоглоом аль хэдийн эхэлсэн байна!' });
      return;
    }

    const nameExists = room.players.some(p => p.name === playerName);
    if (nameExists) {
      socket.emit('error', { message: 'Энэ нэр аль хэдийн ашиглагдаж байна!' });
      return;
    }

    const player = {
      id: socket.id,
      name: playerName,
      score: 0
    };

    room.players.push(player);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;
    socket.isHost = false;

    io.to(roomCode).emit('playerList', { 
      players: room.players,
      count: room.players.length 
    });

    socket.emit('joinedGame', { roomCode, playerName });
    console.log(`${playerName} joined room ${roomCode}`);
  });

  socket.on('startGame', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room || room.hostId !== socket.id) {
      socket.emit('error', { message: 'Зөвхөн зохион байгуулагч тоглоом эхлүүлэх боломжтой!' });
      return;
    }

    if (room.players.length === 0) {
      socket.emit('error', { message: 'Тоглогч байхгүй байна!' });
      return;
    }

    room.started = true;
    room.currentQuestion = 0;
    room.submissions = [];

    io.to(roomCode).emit('gameStarted', { 
      currentQuestion: room.currentQuestion
    });

    console.log(`Game started in room ${roomCode}`);
  });

  socket.on('submitAnswer', ({ age, race, gender }) => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room || socket.isHost) return;

    const currentPerson = people[room.currentQuestion];
    const { points, feedback } = calculatePoints(
      { age, race, gender },
      currentPerson
    );

    // Update player score immediately
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.score += points;
    }

    // Send result to player
    socket.emit('answerResult', { points, feedback });
    socket.emit('scoreUpdate', { score: player.score });

    // Add to submissions for host to view
    room.submissions.push({
      playerId: socket.id,
      playerName: socket.playerName,
      age,
      race,
      gender,
      points,
      feedback
    });

    // Send updated submissions to host
    io.to(room.hostId).emit('submissionsUpdate', { 
      submissions: room.submissions,
      totalPlayers: room.players.length
    });

    console.log(`${socket.playerName} submitted answer: +${points} points`);
  });

  socket.on('nextQuestion', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room || room.hostId !== socket.id) return;

    room.currentQuestion++;
    room.submissions = [];

    if (room.currentQuestion >= people.length) {
      // Game ended
      const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
      io.to(roomCode).emit('gameEnded', { leaderboard: sortedPlayers });
      console.log(`Game ended in room ${roomCode}`);
    } else {
      // Next question
      io.to(roomCode).emit('nextQuestion', { 
        currentQuestion: room.currentQuestion 
      });
      console.log(`Next question in room ${roomCode}: ${room.currentQuestion}`);
    }
  });

  socket.on('endGame', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room || room.hostId !== socket.id) return;

    const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
    io.to(roomCode).emit('gameEnded', { leaderboard: sortedPlayers });
    console.log(`Game manually ended in room ${roomCode}`);
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room) return;

    if (socket.isHost) {
      io.to(roomCode).emit('hostDisconnected', { 
        message: 'Зохион байгуулагч салсан тул тоглоом дууслаа!' 
      });
      delete rooms[roomCode];
      console.log(`Room ${roomCode} deleted - host disconnected`);
    } else {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        // Remove submission if exists
        room.submissions = room.submissions.filter(s => s.playerId !== socket.id);
        
        io.to(roomCode).emit('playerList', { 
          players: room.players,
          count: room.players.length 
        });

        // Update submissions for host
        if (room.started) {
          io.to(room.hostId).emit('submissionsUpdate', { 
            submissions: room.submissions,
            totalPlayers: room.players.length
          });
        }

        console.log(`${playerName} left room ${roomCode}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📂 Serving files from: ${path.join(__dirname, '../public')}`);
});
