// Mobile Safari compatible clipboard functionality
(function() {
    'use strict';
    
    // Function to copy text with mobile Safari fallback
    window.copyToClipboardMobile = function(text) {
        // Try modern Clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text)
                .then(() => {
                    console.log('Copied using Clipboard API');
                    return true;
                })
                .catch(err => {
                    console.log('Clipboard API failed, using fallback:', err);
                    return copyToClipboardFallback(text);
                });
        } else {
            // Use fallback for older browsers
            return copyToClipboardFallback(text);
        }
    };
    
    // Fallback method using textarea (works on mobile Safari)
    function copyToClipboardFallback(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        
        // Make textarea out of viewport
        textarea.style.position = 'fixed';
        textarea.style.top = '-999999px';
        textarea.style.left = '-999999px';
        textarea.style.width = '2em';
        textarea.style.height = '2em';
        textarea.style.padding = 0;
        textarea.style.border = 'none';
        textarea.style.outline = 'none';
        textarea.style.boxShadow = 'none';
        textarea.style.background = 'transparent';
        
        // For mobile devices
        textarea.setAttribute('readonly', '');
        textarea.contentEditable = true;
        textarea.readOnly = false;
        
        document.body.appendChild(textarea);
        
        try {
            // For iOS
            const range = document.createRange();
            range.selectNodeContents(textarea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            textarea.setSelectionRange(0, 999999);
            
            // Execute copy
            const successful = document.execCommand('copy');
            
            if (successful) {
                console.log('Copied using fallback method');
                showCopyNotification('✓ Copied!');
                return true;
            } else {
                showCopyNotification('✗ Copy failed');
                return false;
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            showCopyNotification('✗ Copy error');
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }
    
    // Show notification
    function showCopyNotification(message) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.position = 'fixed';
        notification.style.top = '50%';
        notification.style.left = '50%';
        notification.style.transform = 'translate(-50%, -50%)';
        notification.style.background = message.includes('✓') ? '#4CAF50' : '#f44336';
        notification.style.color = 'white';
        notification.style.padding = '12px 24px';
        notification.style.borderRadius = '4px';
        notification.style.zIndex = '99999';
        notification.style.fontSize = '16px';
        notification.style.fontWeight = 'bold';
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 2000);
    }
    
    console.log('Mobile clipboard helper loaded');
})();
