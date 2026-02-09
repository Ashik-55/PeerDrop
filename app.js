/** 1. IDENTITY & POOLS **/
const adjectives = ["Neon", "Swift", "Cyber", "Solar", "Pixel", "Lunar", "Vortex", "Cosmic", "Ghost", "Bolt", "Astro", "Turbo"];
const animals = ["Fox", "Tiger", "Wolf", "Falcon", "Shark", "Panda", "Dragon", "Phoenix", "Viper", "Raven", "Lynx", "Cobra"];
const icons = ["🦊", "🐯", "🐺", "🦅", "🦈", "🐼", "🐲", "🔥", "🐍", "🐦", "🐱", "🦂"];

const myName = adjectives[Math.floor(Math.random()*adjectives.length)] + animals[Math.floor(Math.random()*animals.length)];
const myAvatar = icons[Math.floor(Math.random()*icons.length)];

// Initialize UI Identity
document.getElementById("myName").textContent = myName;
document.getElementById("myAvatar").textContent = myAvatar;

/** 2. SIGNALING & STATE **/
const socket = new WebSocket("wss://peerdrop-55d4.onrender.com");
let peers = {}; // Stores RTCPeerConnection objects

socket.onopen = () => {
    socket.send(JSON.stringify({ type: "join", name: myName, avatar: myAvatar }));
};

socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    switch(data.type) {
        case "users": renderGrid(data.users); break;
        case "offer": handleIncomingRequest(data); break;
        case "answer": if(peers[data.from]) await peers[data.from].setRemoteDescription(data.answer); break;
        case "candidate": if(peers[data.from]) await peers[data.from].addIceCandidate(data.candidate); break;
    }
};

/** 3. UI RENDERING **/
function renderGrid(users) {
    const grid = document.getElementById("usersGrid");
    const count = document.getElementById("userCount");
    grid.innerHTML = "";
    
    // Filter out our own identity from the list
    const others = users.filter(u => u.name !== myName);
    count.textContent = `${others.length} Peer${others.length === 1 ? '' : 's'} Online`;

    others.forEach(user => {
        // Generate unique accent color based on peer name
        let hash = 0;
        for (let i = 0; i < user.name.length; i++) hash = user.name.charCodeAt(i) + ((hash << 5) - hash);
        const color = `hsl(${Math.abs(hash) % 360}, 70%, 65%)`;

        const card = document.createElement("div");
        card.className = "user-card";
        card.setAttribute("data-id", user.id);
        card.style.setProperty('--user-accent', color);
        
        card.innerHTML = `
            <div class="avatar">${user.avatar}</div>
            <h3 style="color: ${color}">${user.name}</h3>
            <div class="status-chip" style="border: 1px solid ${color}; color: ${color}">Ready</div>
        `;
        
        // Handle clicking a peer to start transfer
        card.onclick = () => initiateTransfer(user.id);
        grid.appendChild(card);
    });
}

/** 4. WEBRTC CORE CONNECTION **/
function createPeer(targetId) {
    const pc = new RTCPeerConnection({ 
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }] 
    });
    peers[targetId] = pc;

    pc.onicecandidate = e => {
        if(e.candidate) {
            socket.send(JSON.stringify({ 
                type: "candidate", 
                target: targetId, 
                candidate: e.candidate 
            }));
        }
    };

    pc.ondatachannel = e => setupReceiverLogic(e.channel, targetId);
    return pc;
}

/** 5. TRANSFER LOGIC (SENDER) **/
async function initiateTransfer(targetId) {
    const pc = createPeer(targetId);
    const dc = pc.createDataChannel("fileStream");
    
    dc.onopen = () => {
        const input = document.getElementById("fileInput");
        input.onchange = () => {
            const file = input.files[0];
            if(!file) return;

            // Step 1: Send Metadata Handshake
            dc.send(JSON.stringify({ protocol: "META", name: file.name, size: file.size }));

            const reader = new FileReader();
            let offset = 0;
            const CHUNK_SIZE = 16384; // 16KB for stability

            reader.onload = e => {
                dc.send(e.target.result);
                offset += e.target.result.byteLength;
                updateUIProgress(offset, file.size);
                
                if (offset < file.size) {
                    readNext();
                } else {
                    // Step 3: Send Completion Signal
                    dc.send(JSON.stringify({ protocol: "EOF" }));
                }
            };

            const readNext = () => reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
            showTransferModal(file.name);
            readNext();
        };
        input.click();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send(JSON.stringify({ type: "offer", target: targetId, offer }));
}

/** 6. HANDSHAKING (RECEIVER) **/
function handleIncomingRequest(data) {
    const modal = document.getElementById("requestModal");
    modal.classList.remove("hidden");
    document.getElementById("requestText").textContent = `${data.senderName} is sending a file.`;

    document.getElementById("acceptBtn").onclick = async () => {
        modal.classList.add("hidden");
        const pc = createPeer(data.from);
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: "answer", target: data.from, answer }));
    };

    document.getElementById("rejectBtn").onclick = () => {
        modal.classList.add("hidden");
    };
}

/** 7. RECEIVER DATA STREAMING **/
function setupReceiverLogic(dc, senderId) {
    let chunks = [], meta = null, receivedSize = 0;

    dc.onmessage = e => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.protocol === "META") {
                meta = msg; chunks = []; receivedSize = 0;
                showTransferModal(meta.name);
                return;
            }
            if (msg.protocol === "EOF") {
                const blob = new Blob(chunks);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = meta.name; a.click();
                
                addHistoryItem(meta.name);
                closeTransferModal();
                return;
            }
        } catch (err) {
            // Processing Binary ArrayBuffer
            chunks.push(e.data);
            receivedSize += e.data.byteLength;
            if (meta) updateUIProgress(receivedSize, meta.size);
        }
    };
}

/** 8. UI HELPERS **/
function showTransferModal(name) {
    document.getElementById("transferModal").classList.remove("hidden");
    document.getElementById("fileName").textContent = name;
}

function updateUIProgress(received, total) {
    const p = Math.floor((received / total) * 100);
    document.getElementById("progressFill").style.width = p + "%";
    document.getElementById("progressText").textContent = p + "%";
    document.getElementById("transferSpeed").textContent = `Streaming bits... ${p}%`;
}

function closeTransferModal() {
    document.getElementById("transferSpeed").textContent = "✓ Transfer Successful";
    setTimeout(() => {
        document.getElementById("transferModal").classList.add("hidden");
        document.getElementById("progressFill").style.width = "0%";
    }, 2000);
}

function addHistoryItem(name) {
    const list = document.getElementById("historyList");
    if (!list) return;
    const li = document.createElement("li");
    li.style.cssText = "list-style:none; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.85rem;";
    li.innerHTML = `<span>📄 ${name}</span> <br> <small style="color:var(--text-dim)">Received at ${new Date().toLocaleTimeString()}</small>`;
    list.prepend(li);

}

