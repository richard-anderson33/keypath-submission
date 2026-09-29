document.addEventListener('DOMContentLoaded', () => {
  // State management
  let state = {
    search: '',
    matchType: 'contains',
    sortBy: 'submittedOn',
    sortOrder: 'desc',
    page: 1,
    pageSize: 5,
    totalCount: 0,
    totalPages: 1,
    records: []
  };

  // DOM Elements
  const searchInput = document.getElementById('searchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const matchTypeSelect = document.getElementById('matchTypeSelect');
  const searchBadge = document.getElementById('searchBadge');
  const searchFeedback = document.getElementById('searchFeedback');
  const resultCountBadge = document.getElementById('resultCountBadge');
  const pageSizeSelect = document.getElementById('pageSizeSelect');
  const gridTableBody = document.getElementById('gridTableBody');
  const lblRangeStart = document.getElementById('lblRangeStart');
  const lblRangeEnd = document.getElementById('lblRangeEnd');
  const lblTotalCount = document.getElementById('lblTotalCount');
  const lblPageIndicator = document.getElementById('lblPageIndicator');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const btnResetSeed = document.getElementById('btnResetSeed');

  // Ingestion Form Elements
  const ingestForm = document.getElementById('ingestForm');
  const ingestStringValue = document.getElementById('ingestStringValue');
  const ingestCategory = document.getElementById('ingestCategory');
  const ingestFormat = document.getElementById('ingestFormat');
  const ingestStatus = document.getElementById('ingestStatus');

  /**
   * Fetch Records from Backend Web API
   */
  async function fetchRecords() {
    try {
      const queryParams = new URLSearchParams({
        search: state.search,
        matchType: state.matchType,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        page: state.page,
        pageSize: state.pageSize
      });

      const res = await fetch(`/api/records?${queryParams.toString()}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      const data = await res.json();
      state.records = data.data;
      state.totalCount = data.totalCount;
      state.totalPages = data.totalPages;

      renderGrid();
      updateSearchFeedback(data.searchApplied, data.searchQuery);
    } catch (err) {
      console.error("Error fetching records:", err);
      gridTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="px-6 py-8 text-center text-rose-500 font-medium">
            <i class="fa-solid fa-triangle-exclamation mr-2"></i> Failed to connect to server backend API.
          </td>
        </tr>`;
    }
  }

  /**
   * Render Table Grid Rows & Pagination Controls
   */
  function renderGrid() {
    gridTableBody.innerHTML = '';

    if (state.records.length === 0) {
      gridTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="px-6 py-8 text-center text-slate-400">
            <i class="fa-solid fa-folder-open text-2xl mb-2"></i>
            <p class="text-sm font-medium">No matching records found.</p>
          </td>
        </tr>`;
    } else {
      state.records.forEach(item => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-[#f3f7fd]/80 transition duration-150';

        const submittedOnFormatted = new Date(item.submittedOn).toLocaleString();
        const modifiedOnFormatted = new Date(item.modifiedOn).toLocaleString();

        let statusClass = 'bg-slate-100 text-slate-700 border-slate-200';
        if (item.status === 'Approved') statusClass = 'bg-emerald-50 text-emerald-800 border-emerald-300';
        if (item.status === 'Active') statusClass = 'bg-[#edf4fc] text-[#0353b4] border-[#b9d5f7]';
        if (item.status === 'Pending') statusClass = 'bg-[#fffbeb] text-[#92400e] border-[#fde68a]';

        row.innerHTML = `
          <td class="px-6 py-4 font-mono text-xs font-bold text-slate-500">#${item.id}</td>
          <td class="px-6 py-4 font-semibold text-[#00264d]">${escapeHtml(item.stringValue)}</td>
          <td class="px-6 py-4 text-xs font-semibold text-slate-600">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              ${escapeHtml(item.category)}
            </span>
          </td>
          <td class="px-6 py-4 text-xs text-slate-500 hidden md:table-cell">${escapeHtml(item.submittedBy)}</td>
          <td class="px-6 py-4 text-xs text-slate-600 whitespace-nowrap">${submittedOnFormatted}</td>
          <td class="px-6 py-4 text-xs text-slate-500 whitespace-nowrap hidden sm:table-cell">${modifiedOnFormatted}</td>
          <td class="px-6 py-4 text-xs text-right whitespace-nowrap">
            <span class="inline-flex items-center px-3 py-0.5 rounded-full text-[11px] font-bold tracking-wider uppercase border ${statusClass}">
              ${escapeHtml(item.status)}
            </span>
          </td>
        `;
        gridTableBody.appendChild(row);
      });
    }

    // Update Pagination indicators
    const start = state.totalCount === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, state.totalCount);

    lblRangeStart.textContent = start;
    lblRangeEnd.textContent = end;
    lblTotalCount.textContent = state.totalCount;
    lblPageIndicator.textContent = `Page ${state.page} of ${state.totalPages}`;

    btnPrevPage.disabled = state.page <= 1;
    btnNextPage.disabled = state.page >= state.totalPages;

    updateSortIcons();
  }

  /**
   * Update Search Feedback Text & Badges
   */
  function updateSearchFeedback(searchApplied, searchQuery) {
    const qLen = searchInput.value.trim().length;

    if (qLen > 0 && qLen < 3) {
      searchBadge.className = 'text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-300';
      searchBadge.textContent = `${3 - qLen} more char(s) needed to search`;
      searchFeedback.innerHTML = `<span class="text-amber-700 font-medium"><i class="fa-solid fa-circle-info mr-1"></i> Input contains ${qLen} char(s). Search activates at 3 chars.</span>`;
      btnClearSearch.classList.remove('hidden');
    } else if (searchApplied) {
      searchBadge.className = 'text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-300';
      searchBadge.textContent = `Search Active`;
      searchFeedback.innerHTML = `<span class="text-[#0353b4] font-medium"><i class="fa-solid fa-check-circle mr-1 text-emerald-600"></i> Filtered by: <strong>"${escapeHtml(searchQuery)}"</strong> (${state.matchType.toUpperCase()})</span>`;
      btnClearSearch.classList.remove('hidden');
    } else {
      searchBadge.className = 'text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200';
      searchBadge.textContent = `Min 3 characters required`;
      searchFeedback.innerHTML = `<span>Showing all records (unfiltered)</span>`;
      btnClearSearch.classList.add('hidden');
    }

    resultCountBadge.textContent = `${state.totalCount} record(s)`;
  }

  /**
   * Column Sort Icons
   */
  function updateSortIcons() {
    document.querySelectorAll('.sort-header').forEach(header => {
      const field = header.getAttribute('data-sort');
      const iconSpan = header.querySelector('.sort-icon');

      if (field === state.sortBy) {
        iconSpan.textContent = state.sortOrder === 'asc' ? ' ▲' : ' ▼';
        header.classList.add('is-sorted');
      } else {
        iconSpan.textContent = ' ⇅';
        header.classList.remove('is-sorted');
      }
    });
  }

  // Helper HTML escaper
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, match => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
      return map[match];
    });
  }

  // --- Event Listeners ---

  // Search input change (triggers search if len >= 3 or clearing)
  searchInput.addEventListener('input', (e) => {
    state.search = e.target.value;
    state.page = 1; // reset to page 1 on new search query
    fetchRecords();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    state.page = 1;
    fetchRecords();
  });

  // Match type select change
  matchTypeSelect.addEventListener('change', (e) => {
    state.matchType = e.target.value;
    state.page = 1;
    fetchRecords();
  });

  // Column Header Click for Sorting
  document.querySelectorAll('.sort-header').forEach(header => {
    header.addEventListener('click', () => {
      const sortField = header.getAttribute('data-sort');
      if (state.sortBy === sortField) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = sortField;
        state.sortOrder = 'asc';
      }
      fetchRecords();
    });
  });

  // Page Size selector
  pageSizeSelect.addEventListener('change', (e) => {
    state.pageSize = parseInt(e.target.value, 10);
    state.page = 1;
    fetchRecords();
  });

  // Pagination Next / Prev
  btnPrevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      fetchRecords();
    }
  });

  btnNextPage.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      fetchRecords();
    }
  });

  // Reset Seed Data button
  btnResetSeed.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/records/reset', { method: 'POST' });
      if (res.ok) {
        state.search = '';
        searchInput.value = '';
        state.page = 1;
        fetchRecords();
      }
    } catch (err) {
      console.error("Failed to reset seed data", err);
    }
  });

  /**
   * Data Ingestion Form Submission (Demonstrating JSON, Form-Data, Query String formats)
   */
  ingestForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const stringVal = ingestStringValue.value.trim();
    const categoryVal = ingestCategory.value.trim() || 'Demo Ingestion';
    const formatChoice = ingestFormat.value;

    ingestStatus.className = 'text-xs p-2.5 rounded-md bg-slate-100 text-slate-700 block';
    ingestStatus.textContent = 'Sending API request...';

    try {
      let response;

      if (formatChoice === 'json') {
        response = await fetch('/api/records/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stringValue: stringVal, category: categoryVal, submittedBy: 'Web App (JSON Payload)' })
        });
      } else if (formatChoice === 'form-data') {
        const formData = new FormData();
        formData.append('stringValue', stringVal);
        formData.append('category', categoryVal);
        formData.append('submittedBy', 'Web App (Form-Data Payload)');

        response = await fetch('/api/records/ingest', {
          method: 'POST',
          body: formData
        });
      } else if (formatChoice === 'query-string') {
        const q = new URLSearchParams({
          stringValue: stringVal,
          category: categoryVal,
          submittedBy: 'Web App (Query String)'
        });
        response = await fetch(`/api/records/ingest?${q.toString()}`, { method: 'GET' });
      }

      const resData = await response.json();

      if (response.ok) {
        ingestStatus.className = 'text-xs p-2.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 block';
        ingestStatus.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> Success! Ingested via <strong>${resData.ingestedFormat}</strong>. ID: #${resData.record.id}`;
        ingestStringValue.value = '';
        ingestCategory.value = '';
        fetchRecords();
      } else {
        ingestStatus.className = 'text-xs p-2.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200 block';
        ingestStatus.textContent = resData.error || 'Ingestion failed.';
      }
    } catch (err) {
      ingestStatus.className = 'text-xs p-2.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200 block';
      ingestStatus.textContent = 'Network or API error submitting record.';
    }
  });

  // Initial Fetch
  fetchRecords();
});
