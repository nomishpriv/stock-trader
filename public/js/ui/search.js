// Search tab
const UISearch = {
    render(results) {
        document.getElementById('searchResults').innerHTML = results.length ? 
            results.map(s => stockCard(s)).join('') : 
            '<div class="empty-state">No results</div>';
    }
};