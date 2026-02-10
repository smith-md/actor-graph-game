/**
 * Skeleton loading components for better UX during API calls
 */
import React from 'react';

// Base skeleton styles
const skeletonStyle = {
  backgroundColor: '#e5e7eb',
  borderRadius: '4px',
  animation: 'pulse 1.5s ease-in-out infinite'
};

// Add keyframes to document if not already present
if (typeof document !== 'undefined' && !document.getElementById('skeleton-keyframes')) {
  const style = document.createElement('style');
  style.id = 'skeleton-keyframes';
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Generic skeleton box
 */
export function SkeletonBox({ width, height, borderRadius, style = {} }) {
  return (
    <div
      style={{
        ...skeletonStyle,
        width: width || '100%',
        height: height || '20px',
        borderRadius: borderRadius || '4px',
        ...style
      }}
    />
  );
}

/**
 * Skeleton for actor card in header
 */
export function ActorCardSkeleton() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      border: '1px solid #e5e7eb',
      borderRadius: '16px',
      padding: '16px 24px',
      backgroundColor: '#f9fafb',
      minWidth: '140px'
    }}>
      <SkeletonBox width="80px" height="20px" style={{ marginBottom: '8px' }} />
      <SkeletonBox width="100px" height="20px" />
    </div>
  );
}

/**
 * Skeleton for actor node in path visualization
 */
export function ActorNodeSkeleton() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px'
    }}>
      <SkeletonBox
        width="120px"
        height="120px"
        borderRadius="50%"
        style={{ border: '3px solid #d1d5db' }}
      />
      <SkeletonBox width="80px" height="16px" />
    </div>
  );
}

/**
 * Skeleton for movie poster in path
 */
export function MoviePosterSkeleton() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px'
    }}>
      <SkeletonBox
        width="120px"
        height="180px"
        borderRadius="8px"
        style={{ border: '2px solid #e5e7eb' }}
      />
    </div>
  );
}

/**
 * Skeleton for the entire game loading state
 */
export function GameLoadingSkeleton() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '32px',
      padding: '40px 20px'
    }}>
      {/* Actor cards */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '32px'
      }}>
        <ActorCardSkeleton />
        <SkeletonBox width="24px" height="24px" borderRadius="50%" />
        <ActorCardSkeleton />
      </div>

      {/* Path visualization placeholder */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        marginTop: '32px'
      }}>
        <ActorNodeSkeleton />
        <SkeletonBox width="80px" height="2px" />
        <SkeletonBox
          width="120px"
          height="180px"
          borderRadius="8px"
          style={{ border: '2px dashed #d1d5db' }}
        />
      </div>

      {/* Loading text */}
      <p style={{
        color: '#6b7280',
        fontSize: '14px',
        marginTop: '16px'
      }}>
        Loading daily puzzle...
      </p>
    </div>
  );
}

/**
 * Skeleton for autocomplete suggestions
 */
export function SuggestionSkeleton({ count = 3 }) {
  return (
    <div style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: '8px',
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '16px',
      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
      overflow: 'hidden',
      zIndex: 50
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 24px',
            borderBottom: i === count - 1 ? 'none' : '1px solid #f3f4f6'
          }}
        >
          <SkeletonBox width="48px" height="48px" borderRadius="12px" />
          <div style={{ flex: 1 }}>
            <SkeletonBox width="120px" height="16px" style={{ marginBottom: '4px' }} />
            <SkeletonBox width="80px" height="12px" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Full-page loading overlay
 */
export function LoadingOverlay({ message = 'Loading...' }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        width: '40px',
        height: '40px',
        border: '3px solid #e5e7eb',
        borderTopColor: '#111827',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
      <p style={{
        marginTop: '16px',
        color: '#6b7280',
        fontSize: '16px'
      }}>
        {message}
      </p>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

/**
 * Inline spinner for buttons
 */
export function ButtonSpinner({ size = 16, color = '#ffffff' }) {
  return (
    <span style={{
      display: 'inline-block',
      width: `${size}px`,
      height: `${size}px`,
      border: `2px solid ${color}40`,
      borderTopColor: color,
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
      marginRight: '8px',
      verticalAlign: 'middle'
    }} />
  );
}

/**
 * Error state with retry button
 */
export function ErrorWithRetry({ message, onRetry }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '40px 20px'
    }}>
      <div style={{
        width: '48px',
        height: '48px',
        margin: '0 auto 16px',
        borderRadius: '50%',
        backgroundColor: '#fef2f2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <span style={{ fontSize: '24px' }}>!</span>
      </div>
      <p style={{
        color: '#991b1b',
        fontSize: '16px',
        marginBottom: '16px'
      }}>
        {message || 'Something went wrong'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '12px 24px',
            backgroundColor: '#111827',
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: '500',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#1f2937'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#111827'}
        >
          Try Again
        </button>
      )}
    </div>
  );
}
