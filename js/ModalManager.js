/**
 * Unified modal management system
 */
export class ModalManager {
    constructor() {
        this.modals = new Map();
        this.activeModal = null;
        this.setupGlobalListeners();
    }

    /**
     * Register a modal
     * @param {string} id - Modal element ID
     * @param {Object} config - Modal configuration
     */
    register(id, config = {}) {
        const modal = document.getElementById(id);
        if (!modal) {
            return;
        }

        this.modals.set(id, {
            element: modal,
            config,
            isOpen: false
        });

        // Setup close button if exists
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close(id));
        }
    }

    /**
     * Show a modal
     * @param {string} id - Modal ID
     * @param {Object} data - Data to pass to modal
     * @returns {Promise} - Resolves when modal is closed
     */
    show(id, data = {}) {
        const modal = this.modals.get(id);
        if (!modal) {
            return Promise.reject();
        }

        // Close any active modal first
        if (this.activeModal && this.activeModal !== id) {
            this.close(this.activeModal);
        }

        modal.element.classList.add('show');
        modal.isOpen = true;
        this.activeModal = id;

        // Call onShow callback if exists
        if (modal.config.onShow) {
            modal.config.onShow(data);
        }

        // Return promise that resolves when modal closes
        return new Promise((resolve) => {
            modal.resolvePromise = resolve;
        });
    }

    /**
     * Close a modal
     * @param {string} id - Modal ID
     * @param {*} result - Result to return
     */
    close(id, result = null) {
        const modal = this.modals.get(id);
        if (!modal || !modal.isOpen) return;

        modal.element.classList.remove('show');
        modal.isOpen = false;

        if (this.activeModal === id) {
            this.activeModal = null;
        }

        // Call onClose callback if exists
        if (modal.config.onClose) {
            modal.config.onClose(result);
        }

        // Resolve promise if exists
        if (modal.resolvePromise) {
            modal.resolvePromise(result);
            modal.resolvePromise = null;
        }
    }

    /**
     * Close the active modal
     */
    closeActive() {
        if (this.activeModal) {
            this.close(this.activeModal);
        }
    }

    /**
     * Setup global event listeners
     */
    setupGlobalListeners() {
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeActive();
            }
        });

        // Close when clicking outside modal
        document.addEventListener('click', (e) => {
            if (this.activeModal && e.target.classList.contains('modal')) {
                this.closeActive();
            }
        });
    }

    /**
     * Show a confirmation dialog
     * @param {string} message - Confirmation message
     * @returns {Promise<boolean>} - Resolves to true if confirmed
     */
    async confirm(message) {
        const confirmModal = document.getElementById('confirmModal');
        if (!confirmModal) {
            // Create confirm modal if it doesn't exist
            const modal = this.createConfirmModal();
            document.body.appendChild(modal);
            this.register('confirmModal', {
                onShow: (data) => {
                    document.getElementById('confirmMessage').textContent = data.message;
                }
            });
        }

        return new Promise((resolve) => {
            const yesBtn = document.querySelector('.confirm-yes');
            const noBtn = document.querySelector('.confirm-no');

            const handleYes = () => {
                cleanup();
                this.close('confirmModal');
                resolve(true);
            };

            const handleNo = () => {
                cleanup();
                this.close('confirmModal');
                resolve(false);
            };

            const cleanup = () => {
                yesBtn.removeEventListener('click', handleYes);
                noBtn.removeEventListener('click', handleNo);
            };

            yesBtn.addEventListener('click', handleYes);
            noBtn.addEventListener('click', handleNo);

            this.show('confirmModal', { message });
        });
    }

    /**
     * Show a notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (info/error)
     * @param {number} duration - Duration in milliseconds
     */
    notify(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        // Auto-hide after duration
        setTimeout(() => {
            notification.classList.add('hiding');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, duration);
    }

    /**
     * Create a confirm modal element
     */
    createConfirmModal() {
        const modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Confirm Action</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="confirm-dialog">
                    <div class="confirm-message" id="confirmMessage">Are you sure?</div>
                    <div class="confirm-buttons">
                        <button class="confirm-no">Cancel</button>
                        <button class="confirm-yes">Confirm</button>
                    </div>
                </div>
            </div>
        `;
        return modal;
    }
}