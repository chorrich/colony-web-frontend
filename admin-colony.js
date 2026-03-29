// Import Firebase Web SDK (V10 Modular API) via CDN - No npm install required for Vercel Static deployment!
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    onSnapshot, 
    addDoc, 
    doc, 
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// ==========================================
// 🔴 TODO: ใส่ค่า Config ของ Firebase ตัวจริงตรงนี้
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDsDnmTs6Npna0TWGbxdKh7i8lxvp1tkHo",
  authDomain: "the-colony-156be.firebaseapp.com",
  projectId: "the-colony-156be",
  storageBucket: "the-colony-156be.firebasestorage.app",
  messagingSenderId: "826905374250",
  appId: "1:826905374250:web:87eb39895d081b052d1d53",
  measurementId: "G-PGCPPWHJ50"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Collection Reference
const usersCol = collection(db, "users");

// DOM Elements
const tbody = document.getElementById("users-tbody");

// ==========================================
// 1. ดึงข้อมูลแบบ Real-time (onSnapshot)
// ==========================================
onSnapshot(usersCol, (snapshot) => {
    tbody.innerHTML = ""; // Clear table
    
    if (snapshot.empty) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-gray-500">No users found in database.</td></tr>`;
        return;
    }

    snapshot.forEach((docSnap) => {
        const user = docSnap.data();
        const id = docSnap.id;
        
        // Build the Row
        const tr = document.createElement("tr");
        tr.className = "hover:bg-gray-700 transition cursor-pointer";
        
        tr.innerHTML = `
            <td class="grid-td font-mono font-bold text-gray-200">${user.mt5 || '-'}</td>
            <td class="grid-td font-medium text-white">${user.name || '-'}</td>
            <td class="grid-td text-gray-400 text-xs">${user.server || '-'}</td>
            <td class="grid-td">
                <input type="text" value="${user.line_id || ''}" onblur="window.updateLineId('${id}', this.value)" 
                       class="w-full bg-transparent border-b border-dashed border-gray-600 focus:border-blue-500 focus:outline-none py-1 text-green-400 font-mono text-xs" 
                       placeholder="U1234...">
            </td>
            <td class="grid-td">
                <input type="text" value="${user.metaapi_id || ''}" onblur="window.updateMetaApiId('${id}', this.value)" 
                       class="w-full bg-transparent border-b border-dashed border-gray-600 focus:border-blue-500 focus:outline-none py-1 text-yellow-400 font-mono text-xs" 
                       placeholder="UUID...">
            </td>
            <td class="grid-td">
                <select onchange="window.updateRole('${id}', this.value)" class="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2">
                    <option value="Investor" ${user.role === 'Investor' ? 'selected' : ''}>Group 1: Investor</option>
                    <option value="Insider" ${user.role === 'Insider' ? 'selected' : ''}>Group 2: Insider</option>
                    <option value="Pro" ${user.role === 'Pro' ? 'selected' : ''}>Group 3: Pro</option>
                </select>
            </td>
            <td class="grid-td text-center">
                <label class="switch">
                    <input type="checkbox" onchange="window.toggleAutoTrade('${id}', this.checked)" ${user.auto_trade ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </td>
            <td class="grid-td">
                <input type="text" value="${user.features || ''}" onblur="window.updateFeatures('${id}', this.value)" 
                       class="w-full bg-transparent border-b border-dashed border-gray-600 focus:border-blue-500 focus:outline-none py-1 text-gray-300 font-mono text-xs" 
                       placeholder="e.g. view_dashboard, auto_trade">
            </td>
            <td class="grid-td text-right">
                <button onclick="window.deleteUser('${id}')" class="text-red-400 hover:text-red-300 font-medium px-2 py-1 rounded bg-red-900 bg-opacity-30 hover:bg-opacity-50 transition">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
});


// ==========================================
// 2. ฟังก์ชันอัพเดทข้อมูลลง Firebase ทันที (Auto Save)
// ==========================================

// Global Window bindings for HTML event listeners (since module scope is private)
window.updateRole = async (docId, newRole) => {
    try {
        await updateDoc(doc(db, "users", docId), { role: newRole });
        console.log(`Updated Role to ${newRole}`);
    } catch (e) {
        alert("Error updating role: " + e.message);
    }
};

window.toggleAutoTrade = async (docId, isEnabled) => {
    try {
        await updateDoc(doc(db, "users", docId), { auto_trade: isEnabled });
        console.log(`Auto Trade set to ${isEnabled}`);
    } catch (e) {
        alert("Error updating auto trade: " + e.message);
    }
};

window.updateFeatures = async (docId, featuresText) => {
    try {
        await updateDoc(doc(db, "users", docId), { features: featuresText });
        console.log(`Features updated`);
    } catch (e) {
        alert("Error updating features: " + e.message);
    }
};

window.updateLineId = async (docId, lineIdText) => {
    try {
        await updateDoc(doc(db, "users", docId), { line_id: lineIdText });
        console.log(`LINE ID updated for ${docId}`);
    } catch (e) {
        alert("Error updating LINE ID: " + e.message);
    }
};

window.updateMetaApiId = async (docId, metaApiText) => {
    try {
        await updateDoc(doc(db, "users", docId), { metaapi_id: metaApiText });
        console.log(`MetaApi ID updated for ${docId}`);
    } catch (e) {
        alert("Error updating MetaApi ID: " + e.message);
    }
};


// ==========================================
// 3. ฟังก์ชันเพิ่มลูกค้าใหม่ (Add New User)
// ==========================================
window.handleSaveUser = async (event) => {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    submitBtn.innerText = "Saving...";
    submitBtn.disabled = true;

    const mt5 = document.getElementById("inp-mt5").value.trim();
    const name = document.getElementById("inp-name").value.trim();
    const server = document.getElementById("inp-server") ? document.getElementById("inp-server").value.trim() : "";
    const line_id = document.getElementById("inp-line") ? document.getElementById("inp-line").value.trim() : "";
    const metaapi_id = document.getElementById("inp-metaapi") ? document.getElementById("inp-metaapi").value.trim() : "";
    const role = document.getElementById("inp-role").value;
    const features = document.getElementById("inp-features").value.trim();

    try {
        await addDoc(collection(db, "users"), {
            mt5: mt5,
            name: name,
            server: server,
            line_id: line_id,
            metaapi_id: metaapi_id,
            role: role,
            auto_trade: false, // Default to off
            features: features,
            created_at: new Date().toISOString()
        });
        
        // Reset form and close modal
        document.getElementById('add-user-form').reset();
        document.getElementById('add-modal').classList.add('hidden');
        alert("✅ Client Added Successfully!");

    } catch (e) {
        alert("Error adding client: " + e.message);
    } finally {
        submitBtn.innerText = "Save to Cloud";
        submitBtn.disabled = false;
    }
};


// ==========================================
// 4. ฟังก์ชันลบลูกค้า (Delete User)
// ==========================================
window.deleteUser = async (docId) => {
    if (confirm("Are you sure you want to delete this MT5 Client completely? This action cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "users", docId));
            console.log("Deleted document", docId);
        } catch (e) {
            alert("Error deleting user: " + e.message);
        }
    }
};
