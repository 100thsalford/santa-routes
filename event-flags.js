// Special-event flag chips ("⏳ Long", "⚽ 8pm") shared by volunteer.html
// and admin.html. A flag is { emoji, label, description, style }.
// Chips show the description on hover (title) and, since hover doesn't
// exist on phones, in a small popover on tap.
(function() {
    var popover = null;
    var popoverFor = null;

    function ensurePopover() {
        if (popover) return popover;
        popover = document.createElement('div');
        popover.className = 'event-flag-popover';
        popover.setAttribute('role', 'tooltip');
        popover.hidden = true;
        document.body.appendChild(popover);
        document.addEventListener('click', function(e) {
            if (popoverFor && !popoverFor.contains(e.target)) hidePopover();
        });
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') hidePopover(); });
        window.addEventListener('resize', hidePopover);
        return popover;
    }

    function hidePopover() {
        if (!popover) return;
        popover.hidden = true;
        if (popoverFor) popoverFor.setAttribute('aria-expanded', 'false');
        popoverFor = null;
    }

    function showPopover(chip, text) {
        var el = ensurePopover();
        if (popoverFor === chip) { hidePopover(); return; }
        hidePopover();
        el.textContent = text;
        el.hidden = false;
        popoverFor = chip;
        chip.setAttribute('aria-expanded', 'true');
        var r = chip.getBoundingClientRect();
        var gutter = 16;
        var left = r.left + window.scrollX;
        var maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - gutter;
        el.style.left = Math.max(window.scrollX + gutter, Math.min(left, maxLeft)) + 'px';
        el.style.top = (r.bottom + window.scrollY + 6) + 'px';
    }

    function chipText(flag) {
        return ((flag.emoji ? flag.emoji + ' ' : '') + (flag.label || '')).trim();
    }

    // One chip. opts.onClick replaces the default tap-for-description
    // behaviour (admin.html uses it to toggle the flag on a night).
    function chip(flag, opts) {
        opts = opts || {};
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'event-flag ' + (flag.style || 'neutral') + (opts.off ? ' is-off' : '');
        b.textContent = chipText(flag);
        var desc = flag.description || flag.label || '';
        b.title = desc;
        b.setAttribute('aria-label', chipText(flag) + (flag.description ? ': ' + flag.description : ''));
        if (opts.onClick) {
            b.setAttribute('aria-pressed', opts.off ? 'false' : 'true');
            b.onclick = opts.onClick;
        } else {
            b.setAttribute('aria-expanded', 'false');
            b.onclick = function(e) { e.stopPropagation(); showPopover(b, desc); };
        }
        return b;
    }

    // Inline chip group for a shift's summary line, or null if no flags.
    function chips(flags) {
        if (!flags || flags.length === 0) return null;
        var wrap = document.createElement('span');
        wrap.className = 'event-flags';
        flags.forEach(function(f) { wrap.appendChild(chip(f)); });
        return wrap;
    }

    // Full-text detail line ("📣 On this night: ⏳ Can be a long route/late
    // finish · ⚽ City Home 8pm"), or null if no flags.
    function detail(flags) {
        if (!flags || flags.length === 0) return null;
        var el = document.createElement('span');
        el.className = 'shift-detail shift-flags-detail';
        el.textContent = '📣 On this night: ' + flags.map(function(f) {
            return ((f.emoji ? f.emoji + ' ' : '') + (f.description || f.label)).trim();
        }).join(' · ');
        return el;
    }

    window.EventFlags = { chip: chip, chips: chips, detail: detail, hidePopover: hidePopover };
})();
