const API_KEY = 'AIzaSyCOjFDu2U4uR56sYWrLgD84RenLkWmHzC8'; 
const ROOT_FOLDER_ID = '1EtYGlzkm1MIG7zB92RU7mVZ-dN5oDpvj';
const AUTO_HIDE_ID = '13_GwQJW8omesqvKhtSlmfl7flvkQTN4r'; 
const EXPIRED_TIME = 172800000; // 48 Jam

let currentPath = [{id: ROOT_FOLDER_ID, name: 'Beranda'}];
let searchTimeout = null; 
let renderQueue = [];
let loadController = null;
let backupAbortController = null;
let finalZipBlob = null;
let finalZipName = "";
let detailsInterval = null;

window.onload = function() { renderBreadcrumbs(); loadAllAndSort(ROOT_FOLDER_ID); };
function restartApp() { localStorage.clear(); sessionStorage.clear(); window.location.reload(); }

// --- TOAST HELPER ---
function showToast(msg, autoHide = false) {
    const toast = document.getElementById('statusToast');
    document.getElementById('statusToastText').innerText = msg;
    toast.classList.remove('hide');
    toast.classList.add('show');
    if (autoHide) setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); }, 3000);
}
function hideToast() {
    const toast = document.getElementById('statusToast');
    toast.classList.remove('show');
    toast.classList.add('hide');
}

// --- CORE: LOAD & SORT ---
async function loadAllAndSort(folderId) {
    if(loadController) loadController.abort();
    loadController = new AbortController();
    const signal = loadController.signal;

    // Reset Containers
    document.getElementById('folderContainer').innerHTML = '';
    document.getElementById('fileContainer').innerHTML = '';
    document.getElementById('lblFolder').style.display = 'none';
    document.getElementById('lblFile').style.display = 'none';
    document.getElementById('centerStatusMsg').style.display = 'none';
    
    showToast("Mengambil data...");

    let allFiles = [];
    let pageToken = null;

    try {
        do {
            if (signal.aborted) break;
            let url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,mimeType,webContentLink,webViewLink,createdTime)&pageSize=1000&key=${API_KEY}`;
            if (pageToken) url += `&pageToken=${pageToken}`;

            const res = await fetch(url, { signal });
            const data = await res.json();

            if (data.files) {
                allFiles = allFiles.concat(data.files);
                showToast(`Memuat... (${allFiles.length} file)`);
            }
            pageToken = data.nextPageToken;
            await new Promise(r => setTimeout(r, 10));
        } while (pageToken);

        if (signal.aborted) return;

        if (folderId === AUTO_HIDE_ID) {
            const now = Date.now();
            allFiles = allFiles.filter(f => {
                const age = now - new Date(f.createdTime).getTime();
                return age < EXPIRED_TIME; 
            });
        }

        // Sorting
        sortFiles(allFiles);

        renderQueue = allFiles;
        if (renderQueue.length === 0) {
            hideToast();
            document.getElementById('centerStatusMsg').innerText = '" Kosong "';
            document.getElementById('centerStatusMsg').style.display = 'block';
        } else {
            showToast("Menampilkan...");
            renderNextBatch();
        }

    } catch (e) {
        if (e.name !== 'AbortError') showToast(`Error: ${e.message}`, true);
    }
}

function sortFiles(fileList) {
    fileList.sort((a, b) => {
        const pA = getFilePriority(a);
        const pB = getFilePriority(b);
        if (pA !== pB) return pA - pB;
        return a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
    });
}

function getFilePriority(file) {
    const name = file.name.toLowerCase();
    if (file.mimeType.includes('folder')) return 1;
    if (name.endsWith('.dst')) return 2;
    if (name.endsWith('.emb')) return 3;
    if (name.match(/\.(jpg|jpeg|png)$/)) return 4;
    return 5;
}

// RENDER: PISAH FOLDER & FILE
function renderNextBatch() {
    if (renderQueue.length === 0) {
        showToast("Selesai.", true);
        return;
    }

    const batchSize = 20;
    const batch = renderQueue.splice(0, batchSize);
    
    // Fragment terpisah
    const folderFrag = document.createDocumentFragment();
    const fileFrag = document.createDocumentFragment();
    
    let hasFolder = false;
    let hasFile = false;

    batch.forEach(f => {
        const div = createCard(f);
        if(div) {
            if(f.mimeType.includes('folder')) {
                folderFrag.appendChild(div);
                hasFolder = true;
            } else {
                fileFrag.appendChild(div);
                hasFile = true;
            }
        }
    });

    if(hasFolder) {
        document.getElementById('folderContainer').appendChild(folderFrag);
        document.getElementById('lblFolder').style.display = 'block';
    }
    if(hasFile) {
        document.getElementById('fileContainer').appendChild(fileFrag);
        document.getElementById('lblFile').style.display = 'block';
    }

    if (renderQueue.length > 0) {
        setTimeout(renderNextBatch, 500); // 0.5 detik
    } else {
        showToast("Semua data ditampilkan.", true);
    }
}

// --- SEARCH LOGIC ---
async function startDeepSearch(keyword) {
    if(loadController) loadController.abort();
    loadController = new AbortController();
    const signal = loadController.signal;

    // Reset Containers
    document.getElementById('folderContainer').innerHTML = '';
    document.getElementById('fileContainer').innerHTML = '';
    document.getElementById('lblFolder').style.display = 'none';
    document.getElementById('lblFile').style.display = 'none';
    document.getElementById('centerStatusMsg').style.display = 'none';
    
    showToast("Mencari (Folder & File)...");

    let matchCount = 0;
    let allMatches = [];
    
    const scanFolderForMatches = async (folderId) => {
        let itemsFound = [];
        let url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+name+contains+'${keyword}'+and+trashed=false&fields=files(id,name,mimeType,webContentLink,webViewLink,createdTime)&pageSize=100&key=${API_KEY}`;
        try {
            const res = await fetch(url, { signal });
            const d = await res.json();
            if(d.files && d.files.length > 0) itemsFound = d.files;
        } catch(e) {}
        return itemsFound;
    };

    const getSubFolders = async (folderId) => {
        let subFolders = [];
        let url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id)&pageSize=100&key=${API_KEY}`;
        try {
            const res = await fetch(url, { signal });
            const d = await res.json();
            if(d.files) subFolders = d.files;
        } catch(e) {}
        return subFolders;
    };

    let folderQueue = [ROOT_FOLDER_ID];
    
    while (folderQueue.length > 0) {
        if(signal.aborted) break;
        const currentBatch = folderQueue.splice(0, 5); 
        
        await Promise.all(currentBatch.map(async (fid) => {
            const matches = await scanFolderForMatches(fid);
            if (matches.length > 0) {
                allMatches = allMatches.concat(matches);
                matchCount += matches.length;
                showToast(`Ditemukan: ${matchCount} data...`);
            }
            const subs = await getSubFolders(fid);
            subs.forEach(s => folderQueue.push(s.id));
        }));
    }

    if (signal.aborted) return;

    if (allMatches.length === 0) {
        hideToast();
        document.getElementById('centerStatusMsg').innerText = '" Tidak Ditemukan "';
        document.getElementById('centerStatusMsg').style.display = 'block';
    } else {
        sortFiles(allMatches);
        renderQueue = allMatches;
        renderNextBatch();
        showToast("Pencarian selesai.", true);
    }
}

function onSearchInput(val) {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!val.trim()) { loadAllAndSort(currentPath[currentPath.length-1].id); return; }
    searchTimeout = setTimeout(() => startDeepSearch(val), 1000);
}

// --- BACKUP LOGIC ---
async function startFolderBackup(folderId, folderName) {
    closeModal('detailsModal');
    const widget = document.getElementById('floatingWidget');
    widget.style.display = 'block';
    document.getElementById('fwStatus').innerText = "Scan folder...";
    document.getElementById('fwBar').style.width = "0%";
    document.getElementById('fwLog').innerHTML = "";
    document.getElementById('fwBtnSave').style.display = 'none';
    
    backupAbortController = new AbortController();
    const signal = backupAbortController.signal;
    const zip = new JSZip();

    try {
        fwLog("Memindai file...", "info");
        let files = [];
        await scanRecursive(folderId, files, "", signal);
        
        if(files.length === 0) {
            alert("Folder kosong.");
            widget.style.display = 'none';
            return;
        }

        fwLog(`Total ${files.length} file.`, "info");
        
        for(let i=0; i<files.length; i++) {
            if(signal.aborted) throw new Error("Stop");
            const item = files[i];
            document.getElementById('fwStatus').innerText = `Unduh ${i+1}/${files.length}: ${item.name}`;
            
            let blob = null;
            for(let attempt=1; attempt<=5; attempt++) {
                if(signal.aborted) break;
                try {
                    const url = `https://www.googleapis.com/drive/v3/files/${item.id}?alt=media&key=${API_KEY}`;
                    const res = await fetch(url, { signal });
                    if(!res.ok) throw new Error("HTTP " + res.status);
                    blob = await res.blob();
                    break; 
                } catch(e) {
                    if(attempt < 5) {
                        fwLog(`⚠ Retry ${attempt}: ${item.name}`, 'retry');
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        fwLog(`✖ GAGAL: ${item.name}`, 'err');
                    }
                }
            }

            if(blob) {
                zip.file(item.path + item.name, blob);
                fwLog(`✔ OK: ${item.name}`, 'ok'); 
            }

            const pct = Math.round(((i+1)/files.length)*100);
            document.getElementById('fwBar').style.width = pct+"%";
            
            if (i < files.length - 1) {
                const delay = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000);
                document.getElementById('fwStatus').innerText = `Jeda aman (${delay/1000}s)...`;
                await new Promise(r => setTimeout(r, delay));
            }
        }

        document.getElementById('fwStatus').innerText = "Memadatkan ZIP...";
        fwLog("Creating ZIP...", "info");
        const content = await zip.generateAsync({type:"blob"});
        
        finalZipBlob = content;
        finalZipName = `Backup_${folderName}.zip`;
        
        document.getElementById('fwStatus').innerText = "Selesai!";
        const btn = document.getElementById('fwBtnSave');
        btn.style.display = 'block';
        btn.innerText = `💾 DOWNLOAD ZIP (${(content.size/1024/1024).toFixed(2)} MB)`;
        fwLog("Backup Selesai.", 'ok');

    } catch(e) {
        if(e.message !== 'Stop') fwLog("Error: " + e.message, 'err');
    }
}

async function scanRecursive(fid, list, path, signal) {
    let pageToken = null;
    do {
        if(signal.aborted) return;
        let url = `https://www.googleapis.com/drive/v3/files?q='${fid}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&key=${API_KEY}`;
        if(pageToken) url += `&pageToken=${pageToken}`;
        try {
            const res = await fetch(url, {signal});
            const d = await res.json();
            if(d.files) {
                for(const f of d.files) {
                    if(f.mimeType.includes('folder')) {
                        await scanRecursive(f.id, list, path + f.name + "/", signal);
                    } else if(f.name.match(/\.(dst|emb|jpg|jpeg|png)$/i)) {
                        f.path = path; 
                        list.push(f); 
                    }
                }
            }
            pageToken = d.nextPageToken;
        } catch(e) { break; }
    } while(pageToken);
}

function saveFinalZip() { if(finalZipBlob) saveAs(finalZipBlob, finalZipName); }
function cancelBackup() { if(backupAbortController) backupAbortController.abort(); document.getElementById('floatingWidget').style.display = 'none'; }
function toggleFwLog() { const l = document.getElementById('fwLog'); l.style.display = l.style.display === 'none' ? 'block' : 'none'; }
function fwLog(m, t) { const d = document.createElement('div'); d.className = `log-item log-${t || 'info'}`; d.innerText = m; const c = document.getElementById('fwLog'); c.appendChild(d); c.scrollTop = c.scrollHeight; }

// --- DOM CREATOR ---
function createCard(f) {
    const n = f.name.toLowerCase();
    const isDir = f.mimeType.includes('folder');
    const isImg = n.match(/\.(jpg|jpeg|png)$/i);
    const isEmb = n.match(/\.(dst|emb)$/i);

    if (!isDir && !isImg && !isEmb) return null;

    let cls = 'file-card';
    let icon = '📄';
    let color = '#999';

    if(isDir) { icon = '📁'; cls += ' is-folder'; } 
    else if(isImg) { icon = '🖼️'; color = '#4285F4'; cls += ' is-file clickable'; } 
    else { icon = '🧵'; color = '#2ecc71'; cls += ' is-file green-hover'; }

    const div = document.createElement('div');
    div.className = cls;

    const infoBtn = document.createElement('div');
    infoBtn.className = 'info-btn';
    infoBtn.innerText = '!';
    infoBtn.onclick = (e) => { e.stopPropagation(); showDetails(f); };

    const iconDiv = document.createElement('div');
    iconDiv.className = 'icon';
    if(!isDir) iconDiv.style.color = color;
    iconDiv.innerText = icon;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'filename';
    nameDiv.innerText = f.name;
    nameDiv.title = f.name;

    div.appendChild(infoBtn); div.appendChild(iconDiv); div.appendChild(nameDiv);

    if (!isDir) {
        const dlBtn = document.createElement('a');
        dlBtn.className = 'btn-download';
        dlBtn.innerText = 'Download';
        dlBtn.href = f.webContentLink || f.webViewLink;
        dlBtn.onclick = (e) => e.stopPropagation();
        div.appendChild(dlBtn);
    }

    if(isDir) div.onclick = () => openFolder(f.id, f.name);
    else if(isImg) div.onclick = (e) => { if(e.target !== infoBtn) openPreview(f.id, f.name); };

    return div;
}

// --- NAV ---
function openFolder(id, name) { currentPath.push({id, name}); renderBreadcrumbs(); loadAllAndSort(id); }
function renderBreadcrumbs() {
    const nav = document.getElementById('breadcrumbNav');
    nav.innerHTML = '';
    if (currentPath.length > 1) {
        const backBtn = document.createElement('button');
        backBtn.className = 'btn-breadcrumb-back'; backBtn.innerHTML = '⬅'; 
        backBtn.onclick = () => { currentPath.pop(); renderBreadcrumbs(); loadAllAndSort(currentPath[currentPath.length-1].id); };
        nav.appendChild(backBtn);
    }
    currentPath.forEach((item, index) => {
        const span = document.createElement('span');
        span.innerText = item.name;
        span.className = index === currentPath.length - 1 ? 'breadcrumb-current' : 'breadcrumb-item';
        if(index !== currentPath.length-1) span.onclick = () => { currentPath = currentPath.slice(0, index + 1); renderBreadcrumbs(); loadAllAndSort(item.id); };
        nav.appendChild(span);
        if (index < currentPath.length - 1) nav.appendChild(document.createTextNode(' / '));
    });
}

// --- MODALS ---
function showDetails(file) {
    if(detailsInterval) clearInterval(detailsInterval);

    document.getElementById('detailName').innerText = file.name;
    document.getElementById('detailDate').innerText = new Date(file.createdTime).toLocaleDateString();
    document.getElementById('detailLocation').innerText = currentPath.map(x=>x.name).join(' > ');
    const cont = document.getElementById('folderBackupContainer');
    cont.innerHTML = '';
    
    // HITUNG MUNDUR (48 JAM FIX)
    const expiryGroup = document.getElementById('expiryGroup');
    const expiryTimer = document.getElementById('expiryTimer');
    const currentFolderId = currentPath[currentPath.length-1].id;

    if (currentFolderId === AUTO_HIDE_ID) {
        expiryGroup.style.display = 'block';
        const updateTimer = () => {
            const now = Date.now();
            const created = new Date(file.createdTime).getTime();
            const diff = EXPIRED_TIME - (now - created);
            
            if (diff <= 0) {
                expiryTimer.innerText = "Sudah Kadaluarsa";
                expiryTimer.style.color = "gray"; 
                clearInterval(detailsInterval);
            } else {
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                expiryTimer.innerText = `Sisa waktu: ${hours}j ${minutes}m ${seconds}d`;
            }
        };
        updateTimer(); 
        detailsInterval = setInterval(updateTimer, 1000);
    } else {
        expiryGroup.style.display = 'none';
    }

    const grp = document.getElementById('detailCountGroup');
    if(file.mimeType.includes('folder')) {
        grp.style.display = 'block';
        document.getElementById('detailCount').innerText = '...';
        const btn = document.createElement('button');
        btn.className = 'btn-folder-backup';
        btn.innerHTML = ' Backup ( Limit )';
        btn.onclick = () => startFolderBackup(file.id, file.name);
        cont.appendChild(btn);
        calculateCountBg(file.id);
    } else { grp.style.display = 'none'; }
    openModal('detailsModal');
}

async function calculateCountBg(id) {
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q='${id}'+in+parents+and+trashed=false&fields=files(id)&pageSize=1000&key=${API_KEY}`);
        const d = await res.json();
        const c = d.files ? d.files.length : 0;
        document.getElementById('detailCount').innerText = c >= 1000 ? "1000+ item" : c + " item (di root ini)";
    } catch(e) { document.getElementById('detailCount').innerText = "Gagal hitung"; }
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id, e) { 
    if(!e || e.target.id === id || e.target.classList.contains('close-btn-rel')) {
        document.getElementById(id).style.display = 'none';
        if(detailsInterval) clearInterval(detailsInterval);
    }
}
function openPreview(id, name) { document.getElementById('previewImage').src = `https://drive.google.com/thumbnail?id=${id}&sz=w4000`; document.getElementById('previewCaption').innerText = name; document.getElementById('previewDownload').href = `https://drive.google.com/uc?export=download&id=${id}`; openModal('imageModal'); }
