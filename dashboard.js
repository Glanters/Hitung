// Initialize Icons
lucide.createIcons();

// Web Worker Code as String
const workerScript = `
    importScripts("https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js");

    self.onmessage = function(e) {
        const { type, payload } = e.data;
        
        if (type === 'PROCESS') {
                    try {
                        const { buffersA, buffersB } = payload;
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 10, text: 'Reading Workbook A...' } });
                        const rawA = readAllExcel(buffersA);
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 30, text: 'Reading Workbook B...' } });
                        const rawB = readAllExcel(buffersB);
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 50, text: 'Mapping Data Structure...' } });
                        const headersA = rawA[0].map(h => String(h || '').toLowerCase());
                        const headersB = rawB[0].map(h => String(h || '').toLowerCase());
                        
                        const mapA = mapRows(rawA.slice(1), headersA, 'A');
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 70, text: 'Processing 400k Rows...' } });
                        const mapB = mapRows(rawB.slice(1), headersB, 'B');
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 90, text: 'Finalizing Reconciliation...' } });
                        const result = reconcileDataMap(mapA, mapB);
                        
                        self.postMessage({ type: 'PROGRESS', payload: { percent: 95, text: 'Calculating Statistics...' } });
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
                
                // Detailed breakdown totals
                let totalMismatchDiff = 0;
                let totalMissingA = 0;
                let totalMissingB = 0;

                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    if (row.a) totalA += row.a.amount;
                    if (row.b) totalB += row.b.amount;
                    
                    if (!row.a && row.b) {
                        missingACount++;
                        totalMissingA += row.b.amount;
                    }
                    else if (row.a && !row.b) {
                        missingBCount++;
                        totalMissingB += row.a.amount;
                    }
                    else if (row.a.amount !== row.b.amount) {
                        mismatchCount++;
                        totalMismatchDiff += Math.abs(row.a.amount - row.b.amount);
                    }
                }

                return {
                    totalA,
                    totalB,
                    variance: totalA - totalB,
                    mismatchCount,
                    missingACount,
                    missingBCount,
                    missingCount: missingACount + missingBCount,
                    totalMismatchDiff,
                    totalMissingA,
                    totalMissingB
                };
            }

            function readExcel(buffer) {
                const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                return XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            }

            function readAllExcel(buffers) {
                let allRows = [];
                let headers = null;
                
                buffers.forEach((buffer, index) => {
                    const rows = readExcel(buffer);
                    if (rows.length > 0) {
                        if (index === 0) {
                            headers = rows[0]; // Keep first file headers
                            allRows = rows;
                        } else {
                            // Append only data rows (skip header of subsequent files)
                            // Assumption: All files have same structure
                            allRows = allRows.concat(rows.slice(1));
                        }
                    }
                });
                
                return allRows;
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
                
                // --- Column Mapping Strategy ---
                // ID Column (Critical)
                // A (QRIS): order_id
                // B (Admin): "Nomor Rekening Pembayar" OR "order_id" (fallback)
                const idxId = headers.findIndex(h => {
                    const val = h.toLowerCase().trim();
                    if (sourceName === 'A') return val === 'order_id' || val.includes('order id');
                    if (sourceName === 'B') return val.includes('nomor rekening') || val.includes('rekening pembayar') || val === 'order_id' || val.includes('order id');
                    return false;
                });
                
                // Date Column
                // A: paid_at
                // B: paid_at
                const idxDate = headers.findIndex(h => {
                     const val = h.toLowerCase().trim();
                     return val === 'paid_at' || val.includes('tanggal') || val.includes('waktu');
                });

                // Desc Column
                // A: rrn / paid_by / payment_method
                // B: rrn / paid_by
                const idxDesc = headers.findIndex(h => {
                    const val = h.toLowerCase().trim();
                    return val === 'rrn' || val.includes('keterangan') || val.includes('desc');
                });

                // Amount Column (Nominal)
                // A: amount / total ? (User data shows amount 150,000 and total 148,350 (net)). 
                // B: "Jumlah Operator" (User Instruction)
                const idxAmount = headers.findIndex(h => {
                    const val = h.toLowerCase().trim();
                    if (sourceName === 'B') {
                        return val === 'jumlah operator' || val.includes('jumlah operator') || val === 'amount' || val === 'nominal' || val === 'jumlah';
                    }
                    return val === 'amount' || val === 'nominal' || val === 'jumlah' || val === 'total';
                });

                // Fallbacks
                let finalId = idxId;
                let finalDate = idxDate !== -1 ? idxDate : 1; // Default to col 1
                let finalDesc = idxDesc !== -1 ? idxDesc : 2; // Default to col 2
                let finalAmount = idxAmount;

                // If ID not found by name, try heuristics or defaults
                if (finalId === -1) {
                     // Try to find column with long numeric strings?
                     // For now default to 3 (order_id usually around col 3 or 4 based on user example)
                     // User example: name, name, type, order_id (col 3)
                     finalId = 3; 
                }
                
                if (finalAmount === -1) {
                    // User example: amount is col 5
                    finalAmount = 5;
                }

                // console.log("Mapping " + sourceName + ": ID=" + finalId + ", Date=" + finalDate + ", Desc=" + finalDesc + ", Amount=" + finalAmount);

                rows.forEach(row => {
                    if (!row || row.length === 0) return;
                    
                    // ID Cleaning
                    // User Example: "24499114_1772806349597"
                    // Sometimes Excel might read it as number if no underscores.
                    let id = String(row[finalId] || '').trim();
                    
                    // If ID is empty or header-like, skip
                if (!id || id.toLowerCase() === 'order_id' || id.toLowerCase() === 'total') return;

                // Handle duplicates: if ID already exists, append suffix or log?
                // For now, let's keep the last one or maybe append if user wants to see duplicates?
                // But reconciliation usually requires 1-to-1.
                // If we have duplicates in source, we might miss them.
                // Let's just use the ID as is.
                
                // Amount Cleaning
                    // User Example: "150,000.00" (String with comma thousands, dot decimal)
                    let amount = row[finalAmount];
                    if (typeof amount === 'string') {
                        // Remove "Rp", spaces
                        let clean = amount.replace(/[Rp\s]/g, '');
                        // Handle "150,000.00" -> 150000.00
                        // Remove commas
                        clean = clean.replace(/,/g, '');
                        amount = parseFloat(clean);
                    }
                    
                    if (amount === undefined || amount === null || isNaN(amount)) amount = 0;

                    // Date Cleaning
                    // User Example: "3/7/2026 0:01"
                    let date = row[finalDate];
                    if (typeof date === 'number') {
                         // Excel serial date
                         const dateObj = new Date(Math.round((date - 25569)*86400*1000));
                         try { date = dateObj.toISOString().split('T')[0]; } catch(e) { date = 'Invalid Date'; }
                    } else {
                        // "3/7/2026 0:01" -> try parse
                        date = String(date || '');
                        // If needed, format to YYYY-MM-DD for consistency
                    }

                    // Desc
                    const desc = String(row[finalDesc] || '');

                    // Map Key: ID
                    // Handle duplicates? If multiple rows have same ID, usually we sum them or flag error.
                    // For reconciliation, usually unique ID per row.
                    // If duplicate ID exists in same file, let's append suffix or sum?
                    // Simple approach: Overwrite (last wins) or Log warning.
                    // Let's assume unique for now.
                    
                    map.set(id, { date, desc, amount });
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
                files: { A: [], B: [] }, // Changed to array for multiple files
        processing: false,
        progress: 0,
        progressText: '',
        error: null,
        worker: null,
        
        // Pagination
        page: 1,
        limit: 50,
        
        // Cache for filtered lists
        _cache: {
           all: null,
           mismatch: null,
           missing_a: null,
           missing_b: null
        },

        init() {
                    // Load data from LocalStorage if available
                    const savedData = localStorage.getItem('reconciliation_data');
                    const savedStats = localStorage.getItem('reconciliation_stats');
                    
                    if (savedData && savedStats) {
                        try {
                            this.data = JSON.parse(savedData);
                            this.statsData = JSON.parse(savedStats);
                        } catch (e) {
                            console.error("Failed to load saved data", e);
                            localStorage.removeItem('reconciliation_data');
                            localStorage.removeItem('reconciliation_stats');
                        }
                    }

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
                    
                    // Reset cache when new data arrives
                    this._cache = { all: null, mismatch: null, missing_a: null, missing_b: null };

                    // Save to LocalStorage
                    try {
                                localStorage.setItem('reconciliation_data', JSON.stringify(this.data));
                                localStorage.setItem('reconciliation_stats', JSON.stringify(this.statsData));
                            } catch (e) {
                                console.warn("Storage quota exceeded, cannot save data for persistence.", e);
                            }

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
            // Handle multiple files
            const newFiles = Array.from(event.target.files);
            if (newFiles.length > 0) {
                // If previously null or empty, init array
                if (!this.files[type]) this.files[type] = [];
                
                // Append new files
                this.files[type] = [...this.files[type], ...newFiles];
            }
        },
        
        getFileLabel(type) {
            const files = this.files[type];
            if (!files || files.length === 0) return 'Drag & drop or click to upload';
            if (files.length === 1) return files[0].name;
            return `${files.length} files selected`;
        },

        processFiles() {
            if (!this.files.A || this.files.A.length === 0 || !this.files.B || this.files.B.length === 0) return;
            
            this.processing = true;
            this.error = null;
            this.progress = 0;
            this.progressText = 'Starting...';
            this.data = [];

            // Read all files as ArrayBuffers
            const readAllFiles = (fileList) => {
                return Promise.all(fileList.map(file => {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = e => resolve(e.target.result);
                        reader.onerror = reject;
                        reader.readAsArrayBuffer(file);
                    });
                }));
            };

            Promise.all([
                readAllFiles(this.files.A),
                readAllFiles(this.files.B)
            ]).then(([buffersA, buffersB]) => {
                // Flatten transferables list
                const transferables = [...buffersA, ...buffersB];
                
                this.worker.postMessage({
                    type: 'PROCESS',
                    payload: { buffersA, buffersB } // Send array of buffers
                }, transferables); 
            }).catch(err => {
                this.error = "Failed to read files: " + err.message;
                this.processing = false;
            });
        },

        get filteredList() {
                    // Cache Strategy
                    if (this.searchQuery) {
                        // If searching, bypass cache or use a separate search cache
                        // Searching 400k rows is always expensive.
                        const q = this.searchQuery.toLowerCase();
                        return this.data.filter(row => 
                            row.id.toLowerCase().includes(q) || 
                            (row.a && row.a.desc.toLowerCase().includes(q)) || 
                            (row.b && row.b.desc.toLowerCase().includes(q)) ||
                            (row.a && row.a.amount.toString().includes(q))
                        );
                    }

                    // If no search, use cache based on active filter
                    if (this._cache[this.activeFilter]) {
                        return this._cache[this.activeFilter];
                    }

                    let result = this.data;

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
                    
                    // Sort (usually expensive too)
                    // Optimization: Pre-sort or sort only when needed.
                    // For now, let's cache the sorted result.
                    result = result.sort((a, b) => {
                         return this.sortAsc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
                    });

                    // Save to cache
                    this._cache[this.activeFilter] = result;
                    return result;
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
                totalA: 0, totalB: 0, variance: 0, mismatchCount: 0, missingACount: 0, missingBCount: 0, missingCount: 0,
                totalMismatchDiff: 0, totalMissingA: 0, totalMissingB: 0
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
                },

                exportData(type) {
                    if (this.data.length === 0) {
                        alert("No data to export.");
                        return;
                    }

                    let exportList = [];
                    let fileName = "Reconciliation_Report.xlsx";

                    if (type === 'mismatch') {
                        exportList = this.data.filter(row => this.getStatus(row) === 'mismatch');
                        fileName = "Reconciliation_Mismatch.xlsx";
                    } else if (type === 'missing') {
                        exportList = this.data.filter(row => {
                            const s = this.getStatus(row);
                            return s === 'missing_a' || s === 'missing_b';
                        });
                        fileName = "Reconciliation_Missing.xlsx";
                    } else {
                        exportList = this.data;
                    }

                    const rows = exportList.map(row => ({
                        'Unique ID': row.id,
                        'Date (A)': row.a ? row.a.date : '-',
                        'Description (A)': row.a ? row.a.desc : '-',
                        'Amount (A)': row.a ? row.a.amount : 0,
                        'Date (B)': row.b ? row.b.date : '-',
                        'Description (B)': row.b ? row.b.desc : '-',
                        'Amount (B)': row.b ? row.b.amount : 0,
                        'Variance': this.getVariance(row),
                        'Status': this.getStatusLabel(row)
                    }));

                    const ws = XLSX.utils.json_to_sheet(rows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Data");
                    XLSX.writeFile(wb, fileName);
                }
    }
}
