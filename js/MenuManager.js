/**
 * Unified menu management system
 */
export class MenuManager {
    constructor(modalManager = null) {
        this.menus = new Map();
        this.activeMenu = null;
        this.modalManager = modalManager;
        this.setupEventListeners();
        this.initializeAllMenus();
    }

    /**
     * Register menu items with their handlers
     * @param {Object} menuConfig - Configuration object with menu structure
     */
    registerMenus(menuConfig) {
        Object.entries(menuConfig).forEach(([menuId, items]) => {
            this.menus.set(menuId, items);
            this.setupMenuItem(menuId);
        });
    }

    /**
     * Setup a single menu item
     * @param {string} menuId - Menu element ID
     */
    setupMenuItem(menuId) {
        const menuItem = document.querySelector(`[data-menu="${menuId}"]`);
        if (!menuItem) return;

        // Setup menu options (click and hover handlers are already set up in initializeAllMenus)
        const items = this.menus.get(menuId);
        const dropdown = menuItem.querySelector('.menu-dropdown');
        if (items && dropdown) {
            this.setupMenuOptions(dropdown, items);
        }
    }

    /**
     * Setup menu options within a menu
     * @param {Element} menuElement - Menu dropdown element
     * @param {Array} items - Menu items configuration
     */
    setupMenuOptions(menuElement, items) {
        items.forEach(item => {
            if (item.id) {
                const option = document.getElementById(item.id);
                if (!option) return;

                // Handle different menu item types
                if (item.type === 'checkbox') {
                    this.setupCheckbox(option, item);
                } else if (item.submenu) {
                    this.setupSubmenu(option, item.submenu);
                } else if (item.handler) {
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (!option.classList.contains('disabled')) {
                            item.handler();
                            this.closeAll();
                        }
                    });
                }

                // Setup keyboard shortcut if exists
                if (item.shortcut) {
                    this.registerShortcut(item.shortcut, item.handler);
                }

                // Set initial disabled state
                if (item.disabled) {
                    option.classList.add('disabled');
                }
            }
        });
    }

    /**
     * Setup checkbox menu item
     * @param {Element} option - Menu option element
     * @param {Object} item - Item configuration
     */
    setupCheckbox(option, item) {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            // Toggle the checked class
            const isChecked = option.classList.toggle('checked');
            
            // Update the visual checkmark
            const checkmark = option.querySelector('.menu-check');
            if (checkmark) {
                checkmark.textContent = isChecked ? '✓' : '';
            }
            
            if (item.handler) {
                item.handler(isChecked);
            }
        });

        // Set initial state
        if (item.checked) {
            option.classList.add('checked');
            const checkmark = option.querySelector('.menu-check');
            if (checkmark) {
                checkmark.textContent = '✓';
            }
        }
    }

    /**
     * Setup submenu
     * @param {Element} option - Menu option element
     * @param {Array} submenuItems - Submenu items
     */
    setupSubmenu(option, submenuItems) {
        const submenu = option.querySelector('.menu-submenu');
        if (!submenu) return;

        submenuItems.forEach(subItem => {
            const subOption = submenu.querySelector(`[data-value="${subItem.value}"]`);
            if (subOption && subItem.handler) {
                subOption.addEventListener('click', (e) => {
                    e.stopPropagation();
                    subItem.handler(subItem.value);
                    this.closeAll();
                });
            }
        });
    }

    /**
     * Toggle a menu open/closed
     * @param {string} menuId - Menu ID
     */
    toggleMenu(menuId) {
        const menuItem = document.querySelector(`[data-menu="${menuId}"]`);
        if (!menuItem) return;

        const isActive = menuItem.classList.contains('active');

        // Close all menus first
        this.closeAll();

        // Open this menu if it wasn't active
        if (!isActive) {
            this.openMenu(menuId);
        }
    }
    
    /**
     * Open a specific menu
     * @param {string} menuId - Menu ID
     */
    openMenu(menuId) {
        const menuItem = document.querySelector(`[data-menu="${menuId}"]`);
        if (menuItem) {
            menuItem.classList.add('active');
            this.activeMenu = menuId;
        }
    }

    /**
     * Close all menus
     */
    closeAll() {
        document.querySelectorAll('.menu-item.active').forEach(item => {
            item.classList.remove('active');
        });
        this.activeMenu = null;
    }

    /**
     * Enable/disable a menu option
     * @param {string} optionId - Option element ID
     * @param {boolean} enabled - Whether to enable or disable
     */
    setEnabled(optionId, enabled) {
        const option = document.getElementById(optionId);
        if (option) {
            if (enabled) {
                option.classList.remove('disabled');
            } else {
                option.classList.add('disabled');
            }
        }
    }

    /**
     * Set checkbox state
     * @param {string} optionId - Option element ID
     * @param {boolean} checked - Whether checked or not
     */
    setChecked(optionId, checked) {
        const option = document.getElementById(optionId);
        if (option) {
            if (checked) {
                option.classList.add('checked');
            } else {
                option.classList.remove('checked');
            }
        }
    }

    /**
     * Register keyboard shortcut
     * @param {string} shortcut - Keyboard shortcut
     * @param {Function} handler - Handler function
     */
    registerShortcut(shortcut, handler) {
        // Parse shortcut (e.g., "Ctrl+N", "Cmd+S")
        const parts = shortcut.toLowerCase().split('+');
        const key = parts[parts.length - 1];
        const modifiers = {
            ctrl: parts.includes('ctrl'),
            cmd: parts.includes('cmd'),
            shift: parts.includes('shift'),
            alt: parts.includes('alt')
        };

        document.addEventListener('keydown', (e) => {
            // Skip if typing in an input field or textarea
            if (e.target.matches('input, textarea')) {
                return;
            }
            
            // Skip if a modal is open
            if (this.modalManager && this.modalManager.activeModal) {
                return;
            }
            
            const keyPressed = e.key.toLowerCase();
            const ctrlOrCmd = navigator.platform.match('Mac') ? e.metaKey : e.ctrlKey;

            if (keyPressed === key &&
                (modifiers.ctrl ? ctrlOrCmd : true) &&
                (modifiers.cmd ? e.metaKey : true) &&
                (modifiers.shift ? e.shiftKey : true) &&
                (modifiers.alt ? e.altKey : true)) {
                e.preventDefault();
                handler();
            }
        });
    }

    /**
     * Initialize all menu items for hover behavior
     */
    initializeAllMenus() {
        // Set up mouseenter for all menu items, even those not registered yet
        document.querySelectorAll('.menu-item[data-menu]').forEach(menuItem => {
            const menuId = menuItem.getAttribute('data-menu');
            
            // Add click handler
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu(menuId);
            });
            
            // Add mouseenter handler for drag-to-open
            menuItem.addEventListener('mouseenter', (e) => {
                if (this.activeMenu && this.activeMenu !== menuId) {
                    this.closeAll();
                    this.openMenu(menuId);
                }
            });
        });
    }

    /**
     * Setup global event listeners
     */
    setupEventListeners() {
        // Close menus when clicking outside
        document.addEventListener('click', () => {
            this.closeAll();
        });

        // Prevent menu dropdowns from closing when clicked
        document.querySelectorAll('.menu-dropdown').forEach(dropdown => {
            dropdown.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });
    }
}