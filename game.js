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

// 在 initializeGame 函数中
function initializeGame(players) {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    
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
        played: [null, null, null, null], // ← 必须是数组！
        currentPlayer: 0,
        startPlayer: 0,
        round: 1,
        phase: 'playing',
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

    // +1 (1-8, 8张) - 注意：存储为 '+1' 而不是 '🎴+1'
    [1,2,3,4,5,6,7,8].forEach((num, i) => {
        deck.push({ 
        top: num, 
        bottom: '+1',  // ← 存储为 '+1'
        color: colors[i % 4], 
        type: 'function' 
    });
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
    if (!gameState) {
        console.warn('⚠️ 游戏状态为空');
        return;
    }

    console.log('🔄 更新游戏界面');

    // 更新信息栏
    document.getElementById('round-num').textContent = gameState.round;
    document.getElementById('reference-point').textContent = gameState.referencePoint;
    
    // 更新方向显示
    const directionText = gameState.direction === 'ccw' ? '⟲ 逆时针' : '⟳ 顺时针';
    document.getElementById('direction').textContent = directionText;
    
    const currentPlayerName = gameState.players[gameState.currentPlayer]?.name || '未知';
    document.getElementById('current-player').textContent = currentPlayerName;
    
    const phaseText = {
        'playing': '出牌阶段',
        'revealing': '翻牌阶段',
        'settling': '结算阶段',
        'round-end': '回合结束',
        'finished': '游戏结束'
    };
    document.getElementById('game-phase').textContent = phaseText[gameState.phase] || gameState.phase;

    // 显示出牌顺序
    updatePlayOrder();

    // 更新其他玩家信息
    updateOtherPlayers();

    // 更新手牌
    renderHand();

    // 更新已出的牌
    renderPlayedCards();

    // 更新日志
    renderLog();
}

// 更新其他玩家信息（按出牌顺序排列）
function updateOtherPlayers() {
    if (!gameState || !gameState.players || !gameState.hands) {
        console.warn('⚠️ 游戏状态不完整，跳过更新其他玩家');
        return;
    }

    // 获取出牌顺序（去除自己）
    const order = [];
    let current = gameState.startPlayer;
    for (let i = 0; i < 4; i++) {
        if (current !== myPlayerIndex) {
            order.push(current);
        }
        current = getNextPlayer(current, gameState.direction);
    }
    
    console.log('👥 其他玩家顺序:', order);

    order.forEach((playerIndex, slotIndex) => {
        const slot = document.getElementById('player-' + slotIndex);
        if (!slot) return;

        const player = gameState.players[playerIndex];
        const handCount = (gameState.hands[playerIndex] && Array.isArray(gameState.hands[playerIndex])) 
            ? gameState.hands[playerIndex].length 
            : 0;
        
        const nameElem = slot.querySelector('.player-name');
        const countElem = slot.querySelector('.hand-count');
        
        // 显示玩家名称和位置标识
        let positionIcon = '';
        if (playerIndex === gameState.currentPlayer && gameState.phase === 'playing') {
            positionIcon = ' 👉';
        } else if (playerIndex === gameState.startPlayer) {
            positionIcon = ' 🎯';
        }
        
        if (nameElem) nameElem.textContent = (player?.name || '玩家' + (playerIndex + 1)) + positionIcon;
        if (countElem) countElem.textContent = `手牌: ${handCount}`;
        
        // 显示是否已出牌
        const playedCard = slot.querySelector('.played-card');
        if (playedCard) {
            const hasPlayed = gameState.played && 
                            Array.isArray(gameState.played) && 
                            gameState.played[playerIndex] !== null && 
                            gameState.played[playerIndex] !== undefined;
            
            if (hasPlayed) {
                playedCard.classList.remove('hidden');
                playedCard.textContent = '✓';
                playedCard.style.background = '#2ecc71';
            } else {
                playedCard.classList.add('hidden');
            }
        }

        // 高亮当前玩家
        if (playerIndex === gameState.currentPlayer && gameState.phase === 'playing') {
            slot.style.border = '3px solid #f39c12';
            slot.style.boxShadow = '0 0 15px rgba(243, 156, 18, 0.5)';
        } else {
            slot.style.border = '';
            slot.style.boxShadow = '';
        }
    });
}

// 渲染手牌
function renderHand() {
    const container = document.getElementById('my-hand');
    if (!container) {
        console.error('❌ 找不到手牌容器');
        return;
    }

    console.log('🎴 开始渲染手牌，myPlayerIndex:', myPlayerIndex);

    if (!gameState) {
        console.warn('⚠️ gameState 为空');
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">等待游戏数据...</p>';
        return;
    }

    if (!gameState.hands) {
        console.warn('⚠️ gameState.hands 为空');
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">手牌数据加载中...</p>';
        return;
    }

    const hand = gameState.hands[myPlayerIndex];
    
    console.log('🎴 我的手牌:', hand);

    if (!hand) {
        console.error('❌ 找不到我的手牌，myPlayerIndex:', myPlayerIndex, 'hands:', gameState.hands);
        container.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">手牌数据错误，请刷新重试</p>';
        return;
    }

    if (!Array.isArray(hand)) {
        console.error('❌ 手牌不是数组:', typeof hand, hand);
        container.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">手牌数据格式错误</p>';
        return;
    }

    if (hand.length === 0) {
        container.innerHTML = '<p style="color: #2ecc71; text-align: center; padding: 20px; font-weight: bold;">🎉 手牌已打完！</p>';
        return;
    }

    container.innerHTML = '';

    hand.forEach((card, index) => {
        if (!card) {
            console.warn('⚠️ 跳过空卡牌，索引:', index);
            return;
        }

        try {
            const cardDiv = createCardElement(card, true);
            
            // 只有轮到自己且在出牌阶段才能点击
            const isMyTurn = gameState.currentPlayer === myPlayerIndex;
            const canPlay = gameState.phase === 'playing';
            
            if (isMyTurn && canPlay) {
                cardDiv.style.cursor = 'pointer';
                cardDiv.style.opacity = '1';
                cardDiv.onclick = () => selectCard(index);
                cardDiv.onmouseenter = () => {
                    cardDiv.style.transform = 'translateY(-10px)';
                };
                cardDiv.onmouseleave = () => {
                    cardDiv.style.transform = 'translateY(0)';
                };
            } else {
                cardDiv.style.cursor = 'not-allowed';
                cardDiv.style.opacity = '0.6';
            }
            
            container.appendChild(cardDiv);
        } catch (error) {
            console.error('❌ 创建卡牌元素失败:', error, card);
        }
    });

    console.log('✅ 手牌渲染完成，共', hand.length, '张');
}

// 创建卡牌元素（边框颜色由展示面决定）
function createCardElement(card, showBoth = false) {
    const div = document.createElement('div');
    
    // 如果是双面显示（手牌），默认使用卡牌颜色
    if (showBoth) {
        div.className = 'card ' + card.color;
        
        const topValue = card.top;
        const bottomValue = card.bottom;
        
        div.innerHTML = `
            ${formatCardValue(topValue, card.color)}
            <div style="font-size: 12px; color: #999; margin: 3px 0;">━━━</div>
            ${formatCardValue(bottomValue, card.color)}
        `;
    } else {
        // 单面显示（已出的牌）
        const shownValue = card.shown || card.top;
        
        // ✅ 关键：根据展示面决定边框颜色
        const isFunctionShown = isFunction(shownValue);
        
        if (isFunctionShown) {
            // 展示功能 → 黑色边框
            div.className = 'card card-function-border';
        } else {
            // 展示数字 → 彩色边框
            div.className = 'card ' + card.color;
        }
        
        div.innerHTML = formatCardValue(shownValue, card.color);
    }
    
    return div;
}

// 判断是否为功能符号
function isFunction(value) {
    const functions = ['x+1', 'x+2', 'x*2', 'Skip', '+1', '⇌'];
    return functions.includes(value);
}

// 格式化单个卡牌值（带CSS类）
function formatCardValue(value, color) {
    if (typeof value === 'number') {
        // 数字使用对应颜色
        const colorMap = {
            'red': '#e74c3c',
            'yellow': '#f39c12',
            'blue': '#3498db',
            'green': '#2ecc71'
        };
        const textColor = colorMap[color] || '#333';
        return `<div style="font-size: 22px; font-weight: bold; color: ${textColor};">${value}</div>`;
    }
    
    // 功能符号使用黑色
    const symbolMap = {
        'x+1': `<div class="transform-symbol">x+1</div>`,
        'x+2': `<div class="transform-symbol">x+2</div>`,
        'x*2': `<div class="transform-symbol">x×2</div>`,
        'Skip': `<div class="skip-symbol">Skip</div>`,
        '+1': `<div class="draw-symbol">🎴+1</div>`,
        '⇌': `<div class="flip-symbol">⇌</div>`
    };
    
    return symbolMap[value] || `<div style="color: #000; font-weight: bold;">${value}</div>`;
}

// formatValue 函数
function formatValue(value) {
    if (typeof value === 'number') return value;
    
    const map = {
        'x+1': 'x+1',
        'x+2': 'x+2',
        'x*2': 'x×2',
        'Skip': 'Skip',
        '+1': '🎴+1',  // ← 显示时添加图标
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
    
    console.log('🎴 选择卡牌:', card);
    
    // 检查是否只能展示某一面
    const topIsForced = ['+1', '⇌'].includes(card.top);
    const bottomIsForced = ['+1', '⇌'].includes(card.bottom);

    if (topIsForced) {
        console.log('⚠️ top 面是功能牌，只能展示这一面');
        playCard(index, 'top');
        return;
    }
    
    if (bottomIsForced) {
        console.log('⚠️ bottom 面是功能牌，只能展示这一面');
        playCard(index, 'bottom');
        return;
    }
    
    // 显示选择界面
    document.getElementById('selected-card').classList.remove('hidden');
    
    const topSide = document.getElementById('top-side');
    const bottomSide = document.getElementById('bottom-side');
    
    // ✅ 根据面的类型设置边框
    const topIsFunction = isFunction(card.top);
    const bottomIsFunction = isFunction(card.bottom);
    
    if (topIsFunction) {
        topSide.className = 'card card-function-border';
    } else {
        topSide.className = 'card ' + card.color;
    }
    topSide.innerHTML = formatCardValue(card.top, card.color);
    
    if (bottomIsFunction) {
        bottomSide.className = 'card card-function-border';
    } else {
        bottomSide.className = 'card ' + card.color;
    }
    bottomSide.innerHTML = formatCardValue(card.bottom, card.color);
    
    window.selectedCardIndex = index;
}

// 选择展示面
function selectSide(side) {
    console.log('👆 选择展示面:', side, '卡牌索引:', window.selectedCardIndex);
    
    if (window.selectedCardIndex === undefined) {
        console.error('❌ 没有选中的卡牌');
        return;
    }
    
    playCard(window.selectedCardIndex, side);
    
    // 隐藏选择界面
    document.getElementById('selected-card').classList.add('hidden');
    window.selectedCardIndex = undefined;
}

// 出牌
function playCard(cardIndex, side) {
    console.log('🎴 出牌：索引', cardIndex, '展示面', side);

    // 严格的数据验证
    if (!gameState) {
        console.error('❌ gameState 不存在');
        alert('游戏状态错误，请刷新页面');
        return;
    }

    if (!gameState.hands || !Array.isArray(gameState.hands)) {
        console.error('❌ gameState.hands 不存在或不是数组');
        alert('手牌数据错误，请刷新页面');
        return;
    }

    if (!gameState.hands[myPlayerIndex]) {
        console.error('❌ 我的手牌不存在');
        alert('手牌数据错误，请刷新页面');
        return;
    }

    const card = gameState.hands[myPlayerIndex][cardIndex];
    
    if (!card) {
        console.error('❌ 卡牌不存在，索引', cardIndex);
        alert('卡牌数据错误');
        return;
    }

    // 构建出牌数据
    const playedCard = {
        ...card,
        shown: side === 'top' ? card.top : card.bottom,
        hidden: side === 'top' ? card.bottom : card.top,
        playerIndex: myPlayerIndex
    };

    console.log('📤 出牌数据:', playedCard);

    // 构建更新
    const updates = {};
    
    // 设置已出的牌
    updates[`played/${myPlayerIndex}`] = playedCard;
    
    // 从手牌移除
    const newHand = gameState.hands[myPlayerIndex].filter((_, i) => i !== cardIndex);
    updates[`hands/${myPlayerIndex}`] = newHand;
    
    // 添加日志
    const playerName = gameState.players[myPlayerIndex]?.name || '玩家' + (myPlayerIndex + 1);
    const newLog = [...(gameState.log || []), `${playerName} 出牌：展示 ${formatValue(playedCard.shown)}`];
    updates['log'] = newLog;
    
    // 安全地检查已出牌数量
    let playedCount = 0;
    if (gameState.played && Array.isArray(gameState.played)) {
        playedCount = gameState.played.filter(p => p !== null && p !== undefined).length;
    }
    
    console.log('📊 当前已出牌数量:', playedCount, '我是第', playedCount + 1, '个出牌');
    
    if (playedCount >= 3) {
        // 我是最后一个出牌的，进入翻牌阶段
        console.log('🎴 所有人出牌完毕，进入翻牌阶段');
        updates['phase'] = 'revealing';
        updates['settleIndex'] = gameState.startPlayer;
        newLog.push('━━━━━━ 开始翻牌 ━━━━━━');
        updates['log'] = newLog;
    } else {
        // 下一个玩家
        const nextPlayer = getNextPlayer(gameState.currentPlayer, gameState.direction);
        updates['currentPlayer'] = nextPlayer;
        console.log('👉 下一个玩家:', nextPlayer);
    }

    // 应用更新
    console.log('💾 准备更新数据库:', updates);
    
    // 应用更新
gameRef.update(updates).then(() => {
    console.log('✅ 出牌成功');
    
    // ✅ 移除立即胜利判定，等待结算后再判定
    if (newHand.length === 0) {
        console.log('🎴 已出完所有手牌，等待结算判定胜利');
    }
}).catch(err => {
        console.error('❌ 出牌失败:', err);
        alert('出牌失败：' + err.message + '\n请重试或刷新页面');
    });
}

// ==================== 结算系统 ====================

// 翻牌阶段（自动触发）
function revealCards() {
    if (!gameState || gameState.phase !== 'revealing') {
        window.isRevealing = false;
        return;
    }

    console.log('🎴 翻牌阶段开始');
    
    // 验证所有玩家都已出牌
    let allPlayed = true;
    for (let i = 0; i < 4; i++) {
        if (!gameState.played[i]) {
            console.error('❌ 玩家', i, '还没出牌！');
            allPlayed = false;
        }
    }

    if (!allPlayed) {
        console.error('❌ 不是所有人都出牌了，返回出牌阶段');
        gameRef.update({ phase: 'playing' });
        window.isRevealing = false;
        return;
    }
    
    // 进入结算阶段
    const newLog = [...gameState.log, '━━━━━━ 开始结算 ━━━━━━'];
    
    gameRef.update({
        phase: 'settling',
        settleIndex: gameState.startPlayer,
        log: newLog
    }).then(() => {
        console.log('✅ 进入结算阶段，从玩家', gameState.startPlayer, '开始');
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
    
    console.log('⚖️ 开始结算玩家', playerIndex);

    // 严格验证
    if (!gameState.played || !Array.isArray(gameState.played)) {
        console.error('❌ gameState.played 不是数组！');
        window.isSettling = false;
        return;
    }

    const playedCard = gameState.played[playerIndex];
    
    if (!playedCard) {
        console.error('❌ 玩家', playerIndex, '没有出牌数据');
        window.isSettling = false;
        return;
    }

    console.log('🎴 结算卡牌:', playedCard);

    // 执行结算计算
    const result = calculateSettle(playedCard, gameState.referencePoint);
    
    console.log('📊 结算结果:', result);

    const updates = {};
    const newLog = [...gameState.log];
    const playerName = gameState.players[playerIndex]?.name || '玩家' + (playerIndex + 1);

    // 添加结算日志
    newLog.push(`【${playerName}】隐藏：${formatValue(playedCard.hidden)} | 展示：${formatValue(playedCard.shown)} | 参考点：${gameState.referencePoint}`);

    // 处理结算结果
    let newReferencePoint = gameState.referencePoint;
    
    if (result.skipDraw) {
        // 跳过摸牌情况（Skip、转换符号）
        newLog.push(`  └─ ${result.reason}`);
        if (result.newReference !== undefined) {
            newReferencePoint = result.newReference;
            if (newReferencePoint !== gameState.referencePoint) {
                newLog.push(`  └─ 参考点更新：${gameState.referencePoint} → ${newReferencePoint}`);
            }
        }
    } else {
        // 正常判定
        if (result.needDraw) {
            newLog.push(`  └─ 结算点 ${result.settlePoint} < 参考点 ${gameState.referencePoint}，摸1张 ✗`);
            
            // 摸牌
            if (gameState.deck && gameState.deck.length > 0) {
                const drawnCard = gameState.deck[gameState.deck.length - 1];
                const newDeck = gameState.deck.slice(0, -1);
                const newHand = [...gameState.hands[playerIndex], drawnCard];
                
                updates['deck'] = newDeck;
                updates[`hands/${playerIndex}`] = newHand;
                newLog.push(`  └─ 摸牌后手牌：${newHand.length}张，牌堆剩余：${newDeck.length}张`);
            } else {
                newLog.push(`  └─ 牌堆已空，无法摸牌`);
            }
        } else {
            newLog.push(`  └─ 结算点 ${result.settlePoint} ≥ 参考点 ${gameState.referencePoint}，不摸牌 ✓`);
        }
        
        newReferencePoint = result.settlePoint;
        newLog.push(`  └─ 参考点更新：${gameState.referencePoint} → ${newReferencePoint}`);
    }

    updates['referencePoint'] = newReferencePoint;

    // 处理展示面效果（+1、翻转）
    const effectResult = applyShownEffect(playedCard, playerIndex, gameState);
    if (effectResult.log && effectResult.log.length > 0) {
        newLog.push(...effectResult.log);
    }
    if (effectResult.updates) {
        Object.assign(updates, effectResult.updates);
    }

    updates['log'] = newLog;

    // 检查是否所有人都结算完
    const settlementOrder = getSettlementOrder(gameState.startPlayer, gameState.direction);
    const currentIndex = settlementOrder.indexOf(playerIndex);
    
    console.log('📍 结算进度:', currentIndex + 1, '/', settlementOrder.length);
    
    if (currentIndex === 3) {
        // 最后一个人，回合结束
        console.log('🏁 回合结算完成');
        newLog.push('━━━━━━ 回合结束 ━━━━━━');
        updates['log'] = newLog;
        updates['phase'] = 'round-end';
        
        gameRef.update(updates).then(() => {
            window.isSettling = false;
            // 检查胜利条件（在回合结算完成后）
function checkWinner() {
    if (!gameState || !gameState.hands) {
        return;
    }

    console.log('🏆 检查胜利条件...');

    // 检查所有玩家的手牌数量
    for (let i = 0; i < 4; i++) {
        const hand = gameState.hands[i];
        if (hand && Array.isArray(hand) && hand.length === 0) {
            // 找到手牌为0的玩家
            const playerName = gameState.players[i]?.name || '玩家' + (i + 1);
            console.log('🎉', playerName, '获胜！手牌数：', hand.length);
            
            // 延迟1秒后宣布胜利
            setTimeout(() => {
                declareWinner(i);
            }, 1000);
            
            return; // 找到胜者，停止检查
        }
    }

    console.log('✓ 暂无玩家获胜，继续游戏');
}
            setTimeout(() => startNextRound(), 2000);
        });
    } else {
        // 下一个人
        const nextPlayerIndex = settlementOrder[currentIndex + 1];
        updates['settleIndex'] = nextPlayerIndex;
        console.log('👉 下一个结算玩家:', nextPlayerIndex);
        
        gameRef.update(updates).then(() => {
            window.isSettling = false;
        });
    }
}

// 计算结算（完全符合游戏规则）
function calculateSettle(card, referencePoint) {
    const hidden = card.hidden;
    const shown = card.shown;

    console.log('🧮 计算结算: 隐藏=', hidden, '展示=', shown, '参考点=', referencePoint);

    // 情况1：隐藏为Skip
    if (hidden === 'Skip') {
        return {
            skipDraw: true,
            reason: 'Skip保护：不摸牌，参考点不变',
            newReference: referencePoint
        };
    }

    // 情况2：隐藏为转换符号
    if (['x+1', 'x+2', 'x*2'].includes(hidden)) {
        let newRef = referencePoint;
        let opName = '';
        
        if (hidden === 'x+1') {
            newRef = Math.min(referencePoint + 1, 10);
            opName = '+1';
        } else if (hidden === 'x+2') {
            newRef = Math.min(referencePoint + 2, 10);
            opName = '+2';
        } else if (hidden === 'x*2') {
            newRef = Math.min(referencePoint * 2, 10);
            opName = '×2';
        }

        return {
            skipDraw: true,
            reason: `${formatValue(hidden)}保护：不摸牌，参考点${opName}`,
            newReference: newRef
        };
    }

    // 情况3：隐藏为点数
    if (typeof hidden !== 'number') {
        // 如果隐藏面是 +1 或 ⇌，这是错误的（这些应该被展示）
        console.error('❌ 错误：功能牌', hidden, '被隐藏了！这违反规则');
        // 容错处理：当作点数1处理
        return {
            skipDraw: false,
            needDraw: true,
            settlePoint: 1
        };
    }

    let settlePoint = hidden;

    // 如果展示为转换符号，修改结算点数
    if (shown === 'x+1') {
        settlePoint = Math.min(hidden + 1, 10);
        console.log('  💫 展示x+1:', hidden, '→', settlePoint);
    } else if (shown === 'x+2') {
        settlePoint = Math.min(hidden + 2, 10);
        console.log('  💫 展示x+2:', hidden, '→', settlePoint);
    } else if (shown === 'x*2') {
        settlePoint = Math.min(hidden * 2, 10);
        console.log('  💫 展示x×2:', hidden, '→', settlePoint);
    }

    // 比较参考点
    const needDraw = settlePoint < referencePoint;

    return {
        skipDraw: false,
        needDraw: needDraw,
        settlePoint: settlePoint
    };
}

// 应用展示面效果（+1、翻转）
function applyShownEffect(card, playerIndex, state) {
    const shown = card.shown;
    const updates = {};
    const log = [];

    console.log('✨ 检查展示面效果:', shown);

    // +1效果（检查原始值，不是格式化后的）
    if (shown === '+1') {  // ← 注意：这里是 '+1' 而不是 '🎴+1'
        log.push('  💥 +1效果触发！');
        
        const order = getSettlementOrder(state.startPlayer, state.direction);
        const currentPos = order.indexOf(playerIndex);
        const prevPlayer = order[(currentPos - 1 + 4) % 4];
        const nextPlayer = order[(currentPos + 1) % 4];

        console.log('  前家:', prevPlayer, '后家:', nextPlayer);

        // ... 其余代码保持不变
        // 前家摸1张
        if (state.deck && state.deck.length > 0) {
            const card1 = state.deck[state.deck.length - 1];
            const newDeck1 = state.deck.slice(0, -1);
            const newHand1 = [...state.hands[prevPlayer], card1];
            
            updates['deck'] = newDeck1;
            updates[`hands/${prevPlayer}`] = newHand1;
            
            const prevName = state.players[prevPlayer]?.name || '玩家' + (prevPlayer + 1);
            log.push(`  └─ ${prevName}（前家）摸1张`);

            // 后家摸1张
            if (newDeck1.length > 0) {
                const card2 = newDeck1[newDeck1.length - 1];
                const newDeck2 = newDeck1.slice(0, -1);
                const newHand2 = [...state.hands[nextPlayer], card2];
                
                updates['deck'] = newDeck2;
                updates[`hands/${nextPlayer}`] = newHand2;
                
                const nextName = state.players[nextPlayer]?.name || '玩家' + (nextPlayer + 1);
                log.push(`  └─ ${nextName}（后家）摸1张`);
            } else {
                log.push(`  └─ 牌堆不足，后家无法摸牌`);
            }
        } else {
            log.push(`  └─ 牌堆已空，前后家无法摸牌`);
        }
    }

    // 翻转效果
    if (shown === '⇌') {
        log.push('  🔄 翻转效果：下回合方向改变');
        updates['flipNext'] = true;
    }

    return { updates, log };
}
// 获取结算顺序（按出牌顺序）
function getSettlementOrder(startPlayer, direction) {
    if (startPlayer === undefined || startPlayer === null) {
        console.error('❌ startPlayer 未定义，默认为0');
        startPlayer = 0;
    }

    const order = [];
    let current = startPlayer;
    
    for (let i = 0; i < 4; i++) {
        order.push(current);
        current = getNextPlayer(current, direction);
    }
    
    console.log('📋 结算顺序:', order, '方向:', direction);
    return order;
}

// 获取下一个玩家
function getNextPlayer(current, direction) {
    if (current === undefined || current === null) {
        console.error('❌ current 未定义，默认为0');
        current = 0;
    }
    
    if (!direction) {
        console.warn('⚠️ direction 未定义，默认为逆时针');
        direction = 'ccw';
    }
    
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

    console.log('🔄 准备开始新回合');

    const updates = {};
    const newLog = [...gameState.log];

    // 处理翻转
    let newDirection = gameState.direction;
    if (gameState.flipNext) {
        newDirection = gameState.direction === 'ccw' ? 'cw' : 'ccw';
        const dirText = newDirection === 'ccw' ? '逆时针 ⟲' : '顺时针 ⟳';
        newLog.push(`🔄 方向改变：${dirText}`);
        updates['flipNext'] = false;
    }

    // 下一个启始玩家
    const nextStart = getNextPlayer(gameState.startPlayer, newDirection);

    newLog.push('━━━━━━━━━━━━━━━━━━━━');
    newLog.push(`🎴 第 ${gameState.round + 1} 回合开始`);
    newLog.push(`📍 启始玩家：${gameState.players[nextStart]?.name || '玩家' + (nextStart + 1)}`);

    updates['round'] = gameState.round + 1;
    updates['phase'] = 'playing';
    updates['played'] = [null, null, null, null]; // ← 重置为数组！
    updates['referencePoint'] = 1;
    updates['currentPlayer'] = nextStart;
    updates['startPlayer'] = nextStart;
    updates['direction'] = newDirection;
    updates['settleIndex'] = nextStart;
    updates['log'] = newLog;

    console.log('📤 更新数据:', updates);

    gameRef.update(updates).then(() => {
        console.log('✅ 新回合开始成功');
    }).catch(err => {
        console.error('❌ 开始新回合失败:', err);
    });
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
    if (!container) {
        console.warn('⚠️ 找不到已出牌容器');
        return;
    }
    
    container.innerHTML = '';

    if (!gameState || !gameState.played || !Array.isArray(gameState.played)) {
        return;
    }

    if (gameState.startPlayer === undefined || !gameState.direction) {
        return;
    }

    const order = getSettlementOrder(gameState.startPlayer, gameState.direction);

    order.forEach(playerIndex => {
        const card = gameState.played[playerIndex];
        if (!card) return;

        try {
            const cardDiv = document.createElement('div');
            
            // ✅ 根据展示面决定边框
            const isFunctionShown = isFunction(card.shown);
            
            if (isFunctionShown) {
                cardDiv.className = 'card card-function-border';
            } else {
                cardDiv.className = 'card ' + (card.color || 'red');
            }
            
            cardDiv.style.margin = '0 5px';
            
            const playerName = gameState.players && gameState.players[playerIndex] 
                ? gameState.players[playerIndex].name 
                : '玩家' + (playerIndex + 1);
            
            // 根据游戏阶段显示不同内容
            if (gameState.phase === 'playing' || gameState.phase === 'revealing') {
                // 只显示展示面
                cardDiv.innerHTML = `
                    ${formatCardValue(card.shown, card.color)}
                    <div style="font-size: 10px; color: #666; margin-top: 8px;">${playerName}</div>
                `;
            } else {
                // 结算阶段，显示双面
                cardDiv.innerHTML = `
                    <div style="font-size: 14px; margin-bottom: 3px;">
                        ${formatCardValue(card.shown, card.color)}
                    </div>
                    <div style="font-size: 10px; color: #999;">━━━</div>
                    <div style="font-size: 14px; margin-top: 3px; padding: 3px; background: #fff3cd; border-radius: 3px;">
                        ${formatCardValue(card.hidden, card.color)}
                    </div>
                    <div style="font-size: 10px; color: #666; margin-top: 5px;">${playerName}</div>
                `;
            }
            
            container.appendChild(cardDiv);
        } catch (error) {
            console.error('❌ 渲染卡牌失败:', error, card);
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

// ==================== 全局错误处理 ====================

window.addEventListener('error', function(event) {
    console.error('🚨 全局错误:', event.error);
    console.error('错误位置:', event.filename, '行', event.lineno);
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('🚨 未处理的Promise错误:', event.reason);
});

// 定期检查连接状态
setInterval(() => {
    if (database && gameRef) {
        const connectedRef = database.ref('.info/connected');
        connectedRef.once('value').then(snap => {
            if (snap.val() === true) {
                console.log('✅ Firebase 连接正常');
            } else {
                console.warn('⚠️ Firebase 连接断开');
            }
        }).catch(err => {
            console.error('❌ 无法检查 Firebase 连接:', err);
        });
    }
}, 30000); // 每30秒检查一次

// 更新出牌顺序显示
function updatePlayOrder() {
    const orderDisplay = document.getElementById('play-order-display');
    const orderText = document.getElementById('play-order-text');
    
    if (!orderDisplay || !orderText) return;
    
    if (!gameState || !gameState.players) {
        orderDisplay.style.display = 'none';
        return;
    }

    // 计算出牌顺序
    const order = [];
    let current = gameState.startPlayer;
    
    for (let i = 0; i < 4; i++) {
        const playerName = gameState.players[current]?.name || '玩家' + (current + 1);
        const isCurrentPlayer = current === gameState.currentPlayer;
        const hasPlayed = gameState.played && gameState.played[current];
        
        let statusIcon = '';
        if (gameState.phase === 'playing' || gameState.phase === 'revealing') {
            if (hasPlayed) {
                statusIcon = ' ✅'; // 已出牌
            } else if (isCurrentPlayer) {
                statusIcon = ' 👉'; // 当前玩家
            } else {
                statusIcon = ' ⏳'; // 等待中
            }
        }
        
        order.push(`${playerName}${statusIcon}`);
        current = getNextPlayer(current, gameState.direction);
    }

    // 添加方向指示
    const arrow = gameState.direction === 'ccw' ? ' → ' : ' ← ';
    orderText.innerHTML = order.join(arrow);
    orderDisplay.style.display = 'flex';
}