// Initialize Icons
lucide.createIcons();

// Web Worker Code as String
const workerScript = `
    importScripts("https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js");

    self.onmessage = function(e) {
        const { type, payload } = e.data;
        
        if (type === 'PROCESS') {
                    try {
                        const { bufferA, bufferB } = payload;
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 10, text: 'Reading Workbook A...' } });
                        const rawA = readExcel(bufferA);
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 30, text: 'Reading Workbook B...' } });
                        const rawB = readExcel(bufferB);
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 50, text: 'Mapping Data Structure...' } });
                        const headersA = rawA[0].map(h => String(h || '').toLowerCase());
                        const headersB = rawB[0].map(h => String(h || '').toLowerCase());
                        
                        const mapA = mapRows(rawA.slice(1), headersA, 'A');
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 70, text: 'Processing 400k Rows...' } });
                        const mapB = mapRows(rawB.slice(1), headersB, 'B');
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 90, text: 'Finalizing Reconciliation...' } });
                        const result = reconcileDataMap(mapA, mapB);
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 90, text: 'Calculating Statistics...' } });
                        const stats = calculateStats(result);
                        
                        self.postMessage({ type: 'DONE', payload: { data: result, stats: stats } });
                    } catch (error) {
                        self.postMessage({ type: 'ERROR', payload: error.message });
                    }
                }
            };

            function calculateStats(data) {
                let totalA = 0;
                let totalB = 0;
                let mismatchCount = 0;
                let missingACount = 0;
                let missingBCount = 0;

                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    if (row.a) totalA += row.a.amount;
                    if (row.b) totalB += row.b.amount;
                    
                    if (!row.a && row.b) missingACount++;
                    else if (row.a && !row.b) missingBCount++;
                    else if (row.a.amount !== row.b.amount) mismatchCount++;
                }

                return {
                    totalA,
                    totalB,
                    variance: totalA - totalB,
                    mismatchCount,
                    missingACount,
                    missingBCount,
                    missingCount: missingACount + missingBCount
                };
            }

            function readExcel(buffer) {
                const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                return XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            }

            function reconcileDataMap(mapA, mapB) {
                const allIds = new Set([...mapA.keys(), ...mapB.keys()]);
                const mergedData = [];
                
                // Convert Set to Array for chunk processing if needed, but for now direct loop
                // Optimization: Pre-allocate array size? No, JS arrays are dynamic.
                
                let count = 0;
                const total = allIds.size;
                
                allIds.forEach(id => {
                    if(!id) return;
                    mergedData.push({
                        id: id,
                        a: mapA.get(id) || null,
                        b: mapB.get(id) || null
                    });
                });

                return mergedData;
            }

    function mapRows(rows, headers, sourceName) {
        const map = new Map();
        
        const idxId = headers.findIndex(h => h.includes('id') || h.includes('ref') || h.includes('trx') || h.includes('code') || h.includes('nomor') || h.includes('unique'));
        const idxDate = headers.findIndex(h => h.includes('date') || h.includes('tanggal') || h.includes('waktu') || h.includes('time'));
        const idxDesc = headers.findIndex(h => h.includes('desc') || h.includes('ket') || h.includes('uraian') || h.includes('detail') || h.includes('name') || h.includes('nama'));
        const idxAmount = headers.findIndex(h => h.includes('amount') || h.includes('nominal') || h.includes('nilai') || h.includes('total') || h.includes('jumlah') || h.includes('harga') || h.includes('bayar'));

        let finalId = idxId !== -1 ? idxId : 0;
        let finalDate = idxDate !== -1 ? idxDate : 1;
        let finalDesc = idxDesc !== -1 ? idxDesc : 2;
        let finalAmount = idxAmount !== -1 ? idxAmount : (headers.length > 3 ? 3 : headers.length - 1);

        rows.forEach(row => {
            if (!row || row.length === 0) return;
            
            const id = String(row[finalId] || '').trim();
            if (!id || id.toLowerCase() === 'total' || id.toLowerCase() === 'grand total') return;

            let amount = row[finalAmount];
            if (typeof amount === 'string') {
                amount = parseFloat(amount.replace(/[^0-9.-]+/g,""));
            }
            if (amount === undefined || amount === null || isNaN(amount)) amount = 0;

            let date = row[finalDate];
            if (typeof date === 'number') {
                    const dateObj = new Date(Math.round((date - 25569)*86400*1000));
                    try { date = dateObj.toISOString().split('T')[0]; } catch(e) { date = 'Invalid Date'; }
            } else {
                date = String(date || '');
            }

            map.set(id, { date, desc: String(row[finalDesc] || ''), amount });
        });

        return map;
    }
`;

function dashboard() {
    return {
        searchQuery: '',
        activeFilter: 'all',
        sortKey: 'id',
        sortAsc: true,
        data: [],
                statsData: null, // Cache for stats
                files: { A: null, B: null },
        processing: false,
        progress: 0,
        progressText: '',
        error: null,
        worker: null,
        
        // Pagination
        page: 1,
        limit: 50,
        
        init() {
            // Create Web Worker
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));
            
            this.worker.onmessage = (e) => {
                const { type, payload } = e.data;
                if (type === 'PROGRESS') {
                    this.progress = payload.percent;
                    this.progressText = payload.text;
                } else if (type === 'DONE') {
                    // Receive separate payload for data and stats
                    this.data = payload.data;
                    this.statsData = payload.stats;
                    this.processing = false;
                    this.progress = 100;
                    this.activeFilter = 'all'; 
                } else if (type === 'ERROR') {
                    this.error = payload;
                    this.processing = false;
                }
            };
        },

        handleFileUpload(event, type) {
            this.error = null;
            const file = event.target.files[0];
            if (file) this.files[type] = file;
        },

        processFiles() {
            if (!this.files.A || !this.files.B) return;
            
            this.processing = true;
            this.error = null;
            this.progress = 0;
            this.progressText = 'Starting...';
            this.data = [];

            // Read files as ArrayBuffer to pass to worker
            const readerA = new FileReader();
            const readerB = new FileReader();

            Promise.all([
                new Promise(resolve => { readerA.onload = e => resolve(e.target.result); readerA.readAsArrayBuffer(this.files.A); }),
                new Promise(resolve => { readerB.onload = e => resolve(e.target.result); readerB.readAsArrayBuffer(this.files.B); })
            ]).then(([bufferA, bufferB]) => {
                this.worker.postMessage({
                    type: 'PROCESS',
                    payload: { bufferA, bufferB }
                }, [bufferA, bufferB]); // Transferables for performance
            }).catch(err => {
                this.error = "Failed to read files: " + err.message;
                this.processing = false;
            });
        },

        get filteredList() {
            // This is the heavy filtering logic, but it's only 1-time per search input
            let result = this.data;

            if (this.searchQuery) {
                const q = this.searchQuery.toLowerCase();
                result = result.filter(row => 
                    row.id.toLowerCase().includes(q) || 
                    (row.a && row.a.desc.toLowerCase().includes(q)) || 
                    (row.b && row.b.desc.toLowerCase().includes(q)) ||
                    (row.a && row.a.amount.toString().includes(q))
                );
            }

            if (this.activeFilter !== 'all') {
                result = result.filter(row => {
                    const s = this.getStatus(row);
                    if (this.activeFilter === 'match') return s === 'match';
                    if (this.activeFilter === 'mismatch') return s === 'mismatch';
                    if (this.activeFilter === 'missing_a') return s === 'missing_a';
                    if (this.activeFilter === 'missing_b') return s === 'missing_b';
                    return true;
                });
            }

            return result.sort((a, b) => {
                    return this.sortAsc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
            });
        },

        // Proxy to filteredList to keep compatibility if needed, but we use pagination now
        get filteredData() {
            return this.filteredList;
        },

        get visibleData() {
            const start = (this.page - 1) * this.limit;
            const end = start + this.limit;
            return this.filteredList.slice(start, end);
        },

        get totalPages() {
            return Math.ceil(this.filteredList.length / this.limit) || 1;
        },

        // Reset page when filter changes
        updateFilter(filter) {
            this.activeFilter = filter;
            this.page = 1;
        },

        get stats() {
            // Optimization: Do NOT recalculate on every render if data hasn't changed.
            // But Alpine.js computed properties are already memoized until dependencies change.
            // The dependency here is `this.data` which is HUGE (400k rows).
            // Accessing `this.data` triggers the proxy trap for the whole array.
            
            // CRITICAL FIX: Return cached stats if available and data length hasn't changed significantly?
            // Better: Calculate stats ONCE inside the worker and pass it back.
            // For now, let's use a simplified approximation or calculate only when explicitly asked?
            // Or: Use a separate `statsData` property that we update manually when data changes.
            
            return this.statsData || {
                totalA: 0, totalB: 0, variance: 0, mismatchCount: 0, missingACount: 0, missingBCount: 0, missingCount: 0
            };
        },

        // --- Helpers ---
        getVariance(row) {
            const valA = row.a ? row.a.amount : 0;
            const valB = row.b ? row.b.amount : 0;
            return valA - valB;
        },

        getStatus(row) {
            if (!row.a && row.b) return 'missing_a';
            if (row.a && !row.b) return 'missing_b';
            if (row.a.amount !== row.b.amount) return 'mismatch';
            return 'match';
        },

        // --- Styling Helpers ---
        getAmountClass(row) {
            if (!row.b) return 'text-slate-700 italic';
            if (!row.a) return 'text-orange-400 font-bold'; 
            if (row.a.amount !== row.b.amount) return 'text-red-400 font-bold bg-red-500/10 rounded px-1';
            return 'text-emerald-400';
        },

        getVarianceClass(row) {
            const v = this.getVariance(row);
            if (v === 0) return 'text-slate-600 opacity-50';
            return 'text-red-400';
        },

        getStatusBadgeClass(row) {
            const s = this.getStatus(row);
            if (s === 'match') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            if (s === 'mismatch') return 'bg-red-500/10 text-red-400 border-red-500/20';
            return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
        },

        getStatusLabel(row) {
            const s = this.getStatus(row);
            if (s === 'match') return 'MATCHED';
            if (s === 'mismatch') return 'MISMATCH';
            if (s === 'missing_b') return 'NOT IN B';
            if (s === 'missing_a') return 'NOT IN A';
            return 'UNKNOWN';
        },

        sortBy(key) {
            if (this.sortKey === key) {
                this.sortAsc = !this.sortAsc;
            } else {
                this.sortKey = key;
                this.sortAsc = true;
            }
            this.page = 1; // Reset to first page on sort
        },

        formatCurrency(value) {
            return new Intl.NumberFormat('id-ID').format(value);
        },

        formatVariance(value) {
            if (value === 0) return '-';
            const sign = value > 0 ? '+' : '';
            return sign + this.formatCurrency(value);
        },
        
        generateMockData() {
                // Simplified mock for demo
                alert("Mock data disabled in optimized mode. Please upload files.");
        }
    }
}
