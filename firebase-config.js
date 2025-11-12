// ==================== Firebase 配置文件 ====================
// 使用 Firebase v8 兼容模式

const firebaseConfig = {
    apiKey: "AIzaSyC6tP-fQVs22o78IUfMHkJti9NcTUB_vtw",
    authDomain: "par-game.firebaseapp.com",
    databaseURL: "https://par-game-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "par-game",
    storageBucket: "par-game.firebasestorage.app",
    messagingSenderId: "354679365746",
    appId: "1:354679365746:web:5a4666dbc3d51b7d49a2eb",
    measurementId: "G-W5F2L34XFQ"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

console.log('✅ Firebase 初始化成功');
console.log('📍 数据库地址:', firebaseConfig.databaseURL);

// 页面加载完成后初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 开始初始化游戏...');
    initGame();
});