// ==================== 全局变量 ====================
let database;
let currentRoom = null;
let currentPlayer = null;
let gameState = null;
let myPlayerIndex = -1;
let roomRef = null;
let gameRef = null;

// ==================== 初始化 ====================
function initGame() {
    database = firebase.database();
    console.log('🎮 游戏系统初始化完成');
}

// 生成房间代码
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ==================== 房间管理 ====================

// 创建房间
function createRoom() {
    const playerName = document.getElementById('player-name').value.trim();
    if (!playerName) {
        alert('请输入昵称！');
        return;
    }

    const roomCode = generateRoomCode();
    currentRoom = roomCode;
    currentPlayer = {
        name: playerName,
        id: Date.now().toString()
    };

    const roomData = {
        host: currentPlayer.id,
        players: {
            [currentPlayer.id]: {
                name: playerName,
                ready: true,
                index: 0
            }
        },
        status: 'waiting',
        createdAt: Date.now()
    };

    database.ref('rooms/' + roomCode).set(roomData).then(() => {
        console.log('✅ 房间创建成功:', roomCode);
        joinLobby(roomCode);
    }).catch(err => {
        console.error('❌ 创建房间失败:', err);
        alert('创建房间失败，请重试');
    });
}

// 加入房间
function joinRoom() {
    const playerName = document.getElementById('player-name').value.trim();
    const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
    
    if (!playerName) {
        alert('请输入昵称！');
        return;
    }
    
    if (!roomCode) {
        alert('请输入房间代码！');
        return;
    }

    database.ref('rooms/' + roomCode).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            alert('房间不存在！');
            return;
        }

        const room = snapshot.val();
        const playerCount = Object.keys(room.players || {}).length;

        if (playerCount >= 4) {
            alert('房间已满！');
            return;
        }

        if (room.status !== 'waiting') {
            alert('游戏已开始！');
            return;
        }

        currentRoom = roomCode;
        currentPlayer = {
            name: playerName,
            id: Date.now().toString()
        };

        database.ref('rooms/' + roomCode + '/players/' + currentPlayer.id).set({
            name: playerName,
            ready: true,
            index: playerCount
        }).then(() => {
            console.log('✅ 加入房间成功:', roomCode);
            joinLobby(roomCode);
        });
    }).catch(err => {
        console.error('❌ 加入房间失败:', err);
        alert('加入房间失败，请重试');
    });
}

// 进入大厅
function joinLobby(roomCode) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
    document.getElementById('display-room-code').textContent = roomCode;

    roomRef = database.ref('rooms/' + roomCode);
    
    // 监听房间变化
    roomRef.on('value', snapshot => {
        const room = snapshot.val();
        if (!room) {
            alert('房间已关闭');
            location.reload();
            return;
        }

        updateLobby(room);

        // 如果游戏开始，切换到游戏界面
        if (room.status === 'playing' && !gameRef) {
            startGameScreen(room);
        }

        // 如果游戏结束
        if (room.status === 'finished') {
            showGameResult(room.game.winner);
        }
    });
}

// 更新大厅
function updateLobby(room) {
    const players = room.players || {};
    const playerCount = Object.keys(players).length;
    
    document.getElementById('player-count').textContent = playerCount;

    const playerList = document.getElementById('player-list');
    playerList.innerHTML = '';
    
    Object.entries(players).forEach(([id, player]) => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.textContent = `${player.name} ${id === room.host ? '👑' : ''}`;
        playerList.appendChild(div);
    });

    // 只有房主且人数够才能开始
    const isHost = room.host === currentPlayer.id;
    const canStart = playerCount === 4;
    const btn = document.getElementById('start-btn');
    btn.disabled = !isHost || !canStart;
    btn.textContent = isHost ? (canStart ? '开始游戏' : `等待玩家 (${playerCount}/4)`) : '等待房主开始';
}

// 复制房间代码
function copyRoomCode() {
    const code = document.getElementById('display-room-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        alert('房间代码已复制：' + code);
    }).catch(() => {
        prompt('房间代码（请手动复制）:', code);
    });
}

// 离开房间
function leaveRoom() {
    if (currentRoom && currentPlayer) {
        database.ref('rooms/' + currentRoom + '/players/' + currentPlayer.id).remove();
    }
    location.reload();
}

// ==================== 游戏开始 ====================

// 开始游戏
function startGame() {
    if (!currentRoom) return;

    console.log('🎲 游戏开始！');
    
    // 获取玩家顺序
    database.ref('rooms/' + currentRoom + '/players').once('value').then(snapshot => {
        const players = snapshot.val();
        const playerOrder = Object.entries(players)
            .sort((a, b) => a[1].index - b[1].index)
            .map(([id, data]) => ({ id, name: data.name }));

        // 初始化游戏状态
        const gameData = initializeGame(playerOrder);
        
        database.ref('rooms/' + currentRoom).update({
            status: 'playing',
            game: gameData
        });
    });
}

// 初始化游戏数据
function initializeGame(players) {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    
    // 分发手牌（每人8张）
    const hands = [[], [], [], []];
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 4; j++) {
            hands[j].push(shuffled.pop());
        }
    }

    return {
        players: players,
        deck: shuffled,
        hands: hands,
        played: [null, null, null, null],
        revealed: [false, false, false, false],
        currentPlayer: 0,
        startPlayer: 0,
        round: 1,
        phase: 'playing', // playing, revealing, settling, finished
        referencePoint: 1,
        direction: 'ccw',
        flipNext: false,
        log: ['🎮 游戏开始！'],
        settleIndex: 0
    };
}

// ==================== 卡牌系统 ====================

// 创建牌堆
function createDeck() {
    const deck = [];
    const colors = ['red', 'yellow', 'blue', 'green'];

    // 同值基本牌 (1-10, 每个4张)
    for (let i = 1; i <= 10; i++) {
        colors.forEach(color => {
            deck.push({ top: i, bottom: i, color: color, type: 'basic' });
        });
    }

    // 异值基本牌 - 标准组合
    const pairs = [[2,4], [4,6], [6,8], [8,10], [1,3], [3,5], [5,7], [7,9]];
    pairs.forEach(pair => {
        colors.forEach(color => {
            deck.push({ top: pair[0], bottom: pair[1], color: color, type: 'basic' });
        });
    });

    // 特殊异值
    deck.push({ top: 2, bottom: 10, color: 'red', type: 'basic' });
    deck.push({ top: 2, bottom: 10, color: 'blue', type: 'basic' });
    deck.push({ top: 1, bottom: 9, color: 'yellow', type: 'basic' });
    deck.push({ top: 1, bottom: 9, color: 'green', type: 'basic' });

    // x+1 (5-8)
    [5,6,7,8].forEach((num, i) => {
        deck.push({ top: num, bottom: 'x+1', color: colors[i], type: 'function' });
    });

    // x+2 (1-4)
    [1,2,3,4].forEach((num, i) => {
        deck.push({ top: num, bottom: 'x+2', color: colors[i], type: 'function' });
    });

    // x*2 (1-4)
    [1,2,3,4].forEach((num, i) => {
        deck.push({ top: num, bottom: 'x*2', color: colors[i], type: 'function' });
    });

    // Skip (5-8, 4张)
    [5,6,7,8].forEach((num, i) => {
        deck.push({ top: num, bottom: 'Skip', color: colors[i], type: 'function' });
    });

    // +1 (1-8, 8张)
    [1,2,3,4,5,6,7,8].forEach((num, i) => {
        deck.push({ top: num, bottom: '+1', color: colors[i % 4], type: 'function' });
    });

    // 翻转 (1-8, 8张)
    [1,2,3,4,5,6,7,8].forEach((num, i) => {
        deck.push({ top: num, bottom: '⇌', color: colors[i % 4], type: 'function' });
    });

    console.log('🎴 牌堆创建完成，共', deck.length, '张');
    return deck;
}

// 洗牌
function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ==================== 游戏界面 ====================

// 开始游戏界面
function startGameScreen(room) {
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');

    // 找到自己的位置
    const players = room.players;
    myPlayerIndex = players[currentPlayer.id].index;

    console.log('🎮 我的位置:', myPlayerIndex);

    gameRef = database.ref('rooms/' + currentRoom + '/game');
    
    // 监听游戏状态
    gameRef.on('value', snapshot => {
        gameState = snapshot.val();
        if (gameState) {
            updateGameScreen();
            
            // 自动结算
            if (gameState.phase === 'revealing' && !window.isRevealing) {
                window.isRevealing = true;
                setTimeout(() => {
                    revealCards();
                }, 1000);
            }
            
            if (gameState.phase === 'settling' && !window.isSettling) {
                window.isSettling = true;
                setTimeout(() => {
                    settleNextPlayer();
                }, 1000);
            }
        }
    });
}

// 更新游戏界面
function updateGameScreen() {
    if (!gameState) return;

    // 更新信息栏
    document.getElementById('round-num').textContent = gameState.round;
    document.getElementById('reference-point').textContent = gameState.referencePoint;
    document.getElementById('direction').textContent = gameState.direction === 'ccw' ? '⟲ 逆时针' : '⟳ 顺时针';
    
    const currentPlayerName = gameState.players[gameState.currentPlayer]?.name || '未知';
    document.getElementById('current-player').textContent = currentPlayerName;
    
    const phaseText = {
        'playing': '出牌阶段',
        'revealing': '翻牌阶段',
        'settling': '结算阶段',
        'finished': '游戏结束'
    };
    document.getElementById('game-phase').textContent = phaseText[gameState.phase] || gameState.phase;

    // 更新其他玩家信息
    updateOtherPlayers();

    // 更新手牌
    renderHand();

    // 更新已出的牌
    renderPlayedCards();

    // 更新日志
    renderLog();
}

// 更新其他玩家信息
function updateOtherPlayers() {
    const otherIndexes = [0, 1, 2, 3].filter(i => i !== myPlayerIndex);
    
    otherIndexes.forEach((playerIndex, slotIndex) => {
        const slot = document.getElementById('player-' + slotIndex);
        if (!slot) return;

        const player = gameState.players[playerIndex];
        const handCount = gameState.hands[playerIndex]?.length || 0;
        
        slot.querySelector('.player-name').textContent = player?.name || '玩家' + (playerIndex + 1);
        slot.querySelector('.hand-count').textContent = `手牌: ${handCount}`;
        
        // 显示是否已出牌
        const playedCard = slot.querySelector('.played-card');
        if (gameState.played[playerIndex]) {
            playedCard.classList.remove('hidden');
            playedCard.textContent = '✓';
        } else {
            playedCard.classList.add('hidden');
        }

        // 高亮当前玩家
        if (playerIndex === gameState.currentPlayer && gameState.phase === 'playing') {
            slot.style.border = '3px solid #f39c12';
        } else {
            slot.style.border = 'none';
        }
    });
}

// 渲染手牌
function renderHand() {
    const hand = gameState.hands[myPlayerIndex] || [];
    const container = document.getElementById('my-hand');
    container.innerHTML = '';

    if (hand.length === 0) {
        container.innerHTML = '<p style="color: #999;">手牌已打完</p>';
        return;
    }

    hand.forEach((card, index) => {
        const cardDiv = createCardElement(card, true);
        
        // 只有轮到自己且在出牌阶段才能点击
        if (gameState.currentPlayer === myPlayerIndex && gameState.phase === 'playing') {
            cardDiv.style.cursor = 'pointer';
            cardDiv.onclick = () => selectCard(index);
        } else {
            cardDiv.style.cursor = 'not-allowed';
            cardDiv.style.opacity = '0.7';
        }
        
        container.appendChild(cardDiv);
    });
}

// 创建卡牌元素
function createCardElement(card, showBoth = false) {
    const div = document.createElement('div');
    div.className = 'card ' + card.color;
    
    if (showBoth) {
        div.innerHTML = `
            <div style="font-size: 18px; font-weight: bold;">${formatValue(card.top)}</div>
            <div style="font-size: 12px; color: #999;">━━━</div>
            <div style="font-size: 18px; font-weight: bold;">${formatValue(card.bottom)}</div>
        `;
    } else {
        div.innerHTML = `<div style="font-size: 24px; font-weight: bold;">${formatValue(card.top)}</div>`;
    }
    
    return div;
}

// 格式化卡牌值
function formatValue(value) {
    if (typeof value === 'number') return value;
    const map = {
        'x+1': '+1',
        'x+2': '+2',
        'x*2': '×2',
        'Skip': 'Skip',
        '+1': '+1',
        '⇌': '⇌'
    };
    return map[value] || value;
}

// 选择卡牌
function selectCard(index) {
    if (gameState.currentPlayer !== myPlayerIndex) {
        alert('还没轮到你！');
        return;
    }

    if (gameState.phase !== 'playing') {
        alert('现在不是出牌阶段！');
        return;
    }

    const card = gameState.hands[myPlayerIndex][index];
    
    // 检查是否只能展示某一面
    const mustShowTop = ['⇌', '+1'].includes(card.bottom);
    const mustShowBottom = ['⇌', '+1'].includes(card.top);

    if (mustShowTop || mustShowBottom) {
        // 自动选择
        const side = mustShowTop ? 'top' : 'bottom';
        playCard(index, side);
        return;
    }
    
    // 显示选择界面
    document.getElementById('selected-card').classList.remove('hidden');
    
    const topSide = document.getElementById('top-side');
    const bottomSide = document.getElementById('bottom-side');
    
    topSide.className = 'card ' + card.color;
    topSide.innerHTML = `<div style="font-size: 24px;">${formatValue(card.top)}</div>`;
    
    bottomSide.className = 'card ' + card.color;
    bottomSide.innerHTML = `<div style="font-size: 24px;">${formatValue(card.bottom)}</div>`;
    
    window.selectedCardIndex = index;
}

// 选择展示面
function selectSide(side) {
    if (window.selectedCardIndex === undefined) return;
    
    playCard(window.selectedCardIndex, side);
    
    // 隐藏选择界面
    document.getElementById('selected-card').classList.add('hidden');
    window.selectedCardIndex = undefined;
}

// 出牌
function playCard(cardIndex, side) {
    const card = gameState.hands[myPlayerIndex][cardIndex];
    
    const playedCard = {
        ...card,
        shown: side === 'top' ? card.top : card.bottom,
        hidden: side === 'top' ? card.bottom : card.top,
        playerIndex: myPlayerIndex
    };

    // 构建更新
    const updates = {};
    
    // 设置已出的牌
    updates[`played/${myPlayerIndex}`] = playedCard;
    
    // 从手牌移除
    const newHand = gameState.hands[myPlayerIndex].filter((_, i) => i !== cardIndex);
    updates[`hands/${myPlayerIndex}`] = newHand;
    
    // 添加日志
    const playerName = gameState.players[myPlayerIndex].name;
    const newLog = [...(gameState.log || []), `${playerName} 出牌：展示 ${formatValue(playedCard.shown)}`];
    updates['log'] = newLog;
    
    // 检查是否所有人都出完牌
    const playedCount = gameState.played.filter(p => p !== null).length;
    
    if (playedCount === 3) {
        // 最后一个人出牌，进入翻牌阶段
        updates['phase'] = 'revealing';
        updates['settleIndex'] = gameState.startPlayer;
        newLog.push('━━━━━━ 开始翻牌 ━━━━━━');
        updates['log'] = newLog;
    } else {
        // 下一个玩家
        const nextPlayer = getNextPlayer(gameState.currentPlayer, gameState.direction);
        updates['currentPlayer'] = nextPlayer;
    }

    // 应用更新
    gameRef.update(updates).then(() => {
        console.log('✅ 出牌成功');
        
        // 检查胜利
        if (newHand.length === 0) {
            declareWinner(myPlayerIndex);
        }
    }).catch(err => {
        console.error('❌ 出牌失败:', err);
        alert('出牌失败，请重试');
    });
}

// ==================== 结算系统 ====================

// 翻牌阶段
function revealCards() {
    if (!gameState || gameState.phase !== 'revealing') {
        window.isRevealing = false;
        return;
    }

    console.log('🎴 翻牌阶段');
    
    // 直接进入结算阶段
    gameRef.update({
        phase: 'settling',
        settleIndex: gameState.startPlayer,
        log: [...gameState.log, '━━━━━━ 开始结算 ━━━━━━']
    }).then(() => {
        window.isRevealing = false;
    });
}

// 结算下一个玩家
function settleNextPlayer() {
    if (!gameState || gameState.phase !== 'settling') {
        window.isSettling = false;
        return;
    }

    const playerIndex = gameState.settleIndex;
    const playedCard = gameState.played[playerIndex];
    
    if (!playedCard) {
        console.error('❌ 结算错误：玩家', playerIndex, '没有出牌');
        window.isSettling = false;
        return;
    }

    console.log('⚖️ 结算玩家', playerIndex);

    // 执行结算
    const result = calculateSettle(playedCard, gameState.referencePoint);
    
    const updates = {};
    const newLog = [...gameState.log];
    const playerName = gameState.players[playerIndex].name;

    // 添加结算日志
    newLog.push(`${playerName} 隐藏：${formatValue(playedCard.hidden)} | 参考点：${gameState.referencePoint}`);

    // 处理结算结果
    let newReferencePoint = gameState.referencePoint;
    
    if (result.skipDraw) {
        newLog.push(`└─ ${result.reason}`);
        if (result.newReference !== undefined) {
            newReferencePoint = result.newReference;
            newLog.push(`└─ 参考点更新：${gameState.referencePoint} → ${newReferencePoint}`);
        }
    } else {
        if (result.needDraw) {
            newLog.push(`└─ 结算点${result.settlePoint} < 参考点${gameState.referencePoint}，摸1张 ✗`);
            
            // 摸牌
            if (gameState.deck.length > 0) {
                const drawnCard = gameState.deck[gameState.deck.length - 1];
                const newDeck = gameState.deck.slice(0, -1);
                const newHand = [...gameState.hands[playerIndex], drawnCard];
                
                updates[`deck`] = newDeck;
                updates[`hands/${playerIndex}`] = newHand;
                newLog.push(`└─ 剩余牌堆：${newDeck.length}张`);
            } else {
                newLog.push(`└─ 牌堆已空！`);
            }
        } else {
            newLog.push(`└─ 结算点${result.settlePoint} ≥ 参考点${gameState.referencePoint}，不摸牌 ✓`);
        }
        
        newReferencePoint = result.settlePoint;
        newLog.push(`└─ 参考点更新：${gameState.referencePoint} → ${newReferencePoint}`);
    }

    updates['referencePoint'] = newReferencePoint;

    // 处理展示面效果
    const effectResult = applyShownEffect(playedCard, playerIndex, gameState);
    if (effectResult.log) {
        newLog.push(...effectResult.log);
    }
    if (effectResult.updates) {
        Object.assign(updates, effectResult.updates);
    }

    updates['log'] = newLog;

    // 检查是否所有人都结算完
    const settlementOrder = getSettlementOrder(gameState.startPlayer, gameState.direction);
    const currentIndex = settlementOrder.indexOf(playerIndex);
    
    if (currentIndex === 3) {
        // 最后一个人，回合结束
        newLog.push('━━━━━━ 回合结束 ━━━━━━');
        updates['log'] = newLog;
        updates['phase'] = 'round-end';
        
        gameRef.update(updates).then(() => {
            window.isSettling = false;
            setTimeout(() => startNextRound(), 2000);
        });
    } else {
        // 下一个人
        updates['settleIndex'] = settlementOrder[currentIndex + 1];
        
        gameRef.update(updates).then(() => {
            window.isSettling = false;
        });
    }
}

// 计算结算
function calculateSettle(card, referencePoint) {
    const hidden = card.hidden;
    const shown = card.shown;

    // 情况1：隐藏为Skip
    if (hidden === 'Skip') {
        return {
            skipDraw: true,
            reason: 'Skip保护，不摸牌，参考点不变',
            newReference: referencePoint // 保持不变
        };
    }

    // 情况2：隐藏为转换符号
    if (['x+1', 'x+2', 'x*2'].includes(hidden)) {
        let newRef = referencePoint;
        
        if (hidden === 'x+1') {
            newRef = referencePoint + 1;
        } else if (hidden === 'x+2') {
            newRef = referencePoint + 2;
        } else if (hidden === 'x*2') {
            newRef = Math.min(referencePoint * 2, 10);
        }

        return {
            skipDraw: true,
            reason: `${formatValue(hidden)} 保护，不摸牌`,
            newReference: newRef
        };
    }

    // 情况3：隐藏为点数
    let settlePoint = hidden;

    // 如果展示为转换符号，修改结算点数
    if (shown === 'x+1') {
        settlePoint = hidden + 1;
    } else if (shown === 'x+2') {
        settlePoint = hidden + 2;
    } else if (shown === 'x*2') {
        settlePoint = Math.min(hidden * 2, 10);
    }

    // 比较参考点
    const needDraw = settlePoint < referencePoint;

    return {
        skipDraw: false,
        needDraw: needDraw,
        settlePoint: settlePoint
    };
}

// 应用展示面效果
function applyShownEffect(card, playerIndex, state) {
    const shown = card.shown;
    const updates = {};
    const log = [];

    // +1效果
    if (shown === '+1') {
        log.push(`💥 +1效果触发！`);
        
        const order = getSettlementOrder(state.startPlayer, state.direction);
        const currentPos = order.indexOf(playerIndex);
        const prevPlayer = order[(currentPos - 1 + 4) % 4];
        const nextPlayer = order[(currentPos + 1) % 4];

        // 前家摸1张
        if (state.deck.length > 0) {
            const card1 = state.deck[state.deck.length - 1];
            updates[`deck`] = state.deck.slice(0, -1);
            updates[`hands/${prevPlayer}`] = [...state.hands[prevPlayer], card1];
            log.push(`└─ ${state.players[prevPlayer].name}（前家）摸1张`);
        }

        // 后家摸1张
        if (state.deck.length > 1) {
            const card2 = state.deck[state.deck.length - 2];
            updates[`deck`] = state.deck.slice(0, -2);
            updates[`hands/${nextPlayer}`] = [...state.hands[nextPlayer], card2];
            log.push(`└─ ${state.players[nextPlayer].name}（后家）摸1张`);
        }
    }

    // 翻转效果
    if (shown === '⇌') {
        log.push(`🔄 翻转效果：下回合方向改变`);
        updates['flipNext'] = true;
    }

    return { updates, log };
}

// 获取结算顺序
function getSettlementOrder(startPlayer, direction) {
    const order = [];
    let current = startPlayer;
    
    for (let i = 0; i < 4; i++) {
        order.push(current);
        current = getNextPlayer(current, direction);
    }
    
    return order;
}

// 获取下一个玩家
function getNextPlayer(current, direction) {
    if (direction === 'ccw') {
        return (current + 1) % 4;
    } else {
        return (current - 1 + 4) % 4;
    }
}

// ==================== 回合管理 ====================

// 开始下一回合
function startNextRound() {
    if (!gameState) return;

    console.log('🔄 开始新回合');

    const updates = {};
    const newLog = [...gameState.log];

    // 处理翻转
    let newDirection = gameState.direction;
    if (gameState.flipNext) {
        newDirection = gameState.direction === 'ccw' ? 'cw' : 'ccw';
        newLog.push(`🔄 方向改变：${newDirection === 'ccw' ? '逆时针' : '顺时针'}`);
        updates['flipNext'] = false;
    }

    // 下一个启始玩家
    const nextStart = getNextPlayer(gameState.startPlayer, newDirection);

    updates['round'] = gameState.round + 1;
    updates['phase'] = 'playing';
    updates['played'] = [null, null, null, null];
    updates['referencePoint'] = 1;
    updates['currentPlayer'] = nextStart;
    updates['startPlayer'] = nextStart;
    updates['direction'] = newDirection;
    updates['settleIndex'] = nextStart;
    
    newLog.push('━━━━━━━━━━━━━━━━━━━━');
    newLog.push(`🎴 第${gameState.round + 1}回合开始`);
    updates['log'] = newLog;

    gameRef.update(updates);
}

// ==================== 胜利判定 ====================

// 宣布胜利
function declareWinner(winnerIndex) {
    console.log('🏆 玩家', winnerIndex, '获胜！');

    const winner = gameState.players[winnerIndex];
    
    gameRef.update({
        phase: 'finished',
        winner: {
            index: winnerIndex,
            name: winner.name
        },
        log: [...gameState.log, `🏆 ${winner.name} 获胜！`]
    });

    database.ref('rooms/' + currentRoom).update({
        status: 'finished'
    });
}

// 显示游戏结果
function showGameResult(winner) {
    if (!winner) return;

    const isWinner = winner.index === myPlayerIndex;
    
    const message = isWinner 
        ? `🎉 恭喜你获胜！🎉` 
        : `🏆 ${winner.name} 获胜！`;

    setTimeout(() => {
        if (confirm(message + '\n\n是否返回大厅？')) {
            location.reload();
        }
    }, 1000);
}

// ==================== UI更新 ====================

// 渲染已出的牌
function renderPlayedCards() {
    const container = document.getElementById('played-cards');
    container.innerHTML = '';

    const order = getSettlementOrder(gameState.startPlayer, gameState.direction);

    order.forEach(playerIndex => {
        const card = gameState.played[playerIndex];
        if (card) {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'card ' + card.color;
            cardDiv.style.margin = '0 5px';
            
            const playerName = gameState.players[playerIndex].name;
            
            // 如果还在出牌阶段或翻牌阶段，只显示展示面
            if (gameState.phase === 'playing' || gameState.phase === 'revealing') {
                cardDiv.innerHTML = `
                    <div style="font-size: 24px; font-weight: bold;">${formatValue(card.shown)}</div>
                    <div style="font-size: 10px; color: #666; margin-top: 5px;">${playerName}</div>
                `;
            } else {
                // 结算阶段，显示双面
                cardDiv.innerHTML = `
                    <div style="font-size: 16px; font-weight: bold;">${formatValue(card.shown)}</div>
                    <div style="font-size: 12px; color: #999;">━━━</div>
                    <div style="font-size: 16px; font-weight: bold; color: #e74c3c;">${formatValue(card.hidden)}</div>
                    <div style="font-size: 10px; color: #666; margin-top: 5px;">${playerName}</div>
                `;
            }
            
            container.appendChild(cardDiv);
        }
    });
}

// 渲染日志
function renderLog() {
    const container = document.getElementById('game-log');
    container.innerHTML = '';

    const logs = gameState.log || [];
    
    // 只显示最近20条
    logs.slice(-20).forEach(entry => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = entry;
        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
}

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🎴 《牌》游戏加载完成');
    initGame();
});