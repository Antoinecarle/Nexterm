import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, getToken } from '../api';

export default function Media() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('library');

  // ─── Library State (existing) ───
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileInputRef = useRef(null);

  // ─── Campaigns State ───
  const [projects, setProjects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedCampaignItems, setSelectedCampaignItems] = useState([]);
  const [isGeneratingCampaign, setIsGeneratingCampaign] = useState(false);
  const [generatingImageId, setGeneratingImageId] = useState(null);
  const [campaignForm, setCampaignForm] = useState({
    projectName: '',
    platform: 'LinkedIn',
    description: '',
    imageCount: 3
  });

  // ─── Image Studio State ───
  const [studioImages, setStudioImages] = useState([]);
  const [studioPreviews, setStudioPreviews] = useState({});
  const [studioForm, setStudioForm] = useState({
    prompt: '',
    quantity: 1,
    aspectRatio: '1:1',
    model: 'fast'
  });
  const [isGeneratingStudio, setIsGeneratingStudio] = useState(false);

  // ─── Jobs State ───
  const [activeJobs, setActiveJobs] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const pollingRef = useRef(null);

  // ─── Library Methods (existing) ───

  const fetchMedia = useCallback(async () => {
    try {
      const data = await api('/api/media/list');
      setFiles(data || []);
      (data || []).filter((f) => f.type === 'image').forEach((f) => fetchImageBlob(f.name));
    } catch (err) {
      console.error('Failed to load media:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchImageBlob = async (name) => {
    try {
      const res = await fetch(`/api/media/file/${name}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviews((prev) => ({ ...prev, [name]: url }));
    } catch (_) {}
  };

  const fetchStudioImageBlob = async (name) => {
    try {
      const res = await fetch(`/api/media/file/generated/${name}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setStudioPreviews((prev) => ({ ...prev, [name]: url }));
    } catch (_) {}
  };

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // Fetch campaigns + projects + studio images + active jobs on mount
  useEffect(() => {
    (async () => {
      try {
        const [projectsRes, campaignsRes, studioRes, activeRes] = await Promise.all([
          api('/api/media-ai/projects-indexed'),
          api('/api/media-ai/campaigns'),
          api('/api/media/list/generated'),
          api('/api/media-ai/jobs/active'),
        ]);
        if (projectsRes?.projects) setProjects(projectsRes.projects);
        if (campaignsRes?.campaigns) setCampaigns(campaignsRes.campaigns);
        if (Array.isArray(studioRes)) {
          setStudioImages(studioRes);
          studioRes.filter(f => f.type === 'image').forEach(f => fetchStudioImageBlob(f.name));
        }
        if (activeRes?.jobs && activeRes.jobs.length > 0) {
          setActiveJobs(activeRes.jobs);
          startPolling();
        }
      } catch (_) {}
    })();
  }, []);

  const handleUpload = async (fileList) => {
    if (!fileList || !fileList.length) return;
    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) formData.append('files', fileList[i]);
    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      await fetchMedia();
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (e, name) => {
    e.stopPropagation();
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await api(`/api/media/file/${name}`, { method: 'DELETE' });
      setFiles((prev) => prev.filter((f) => f.name !== name));
      if (previews[name]) {
        URL.revokeObjectURL(previews[name]);
        setPreviews((prev) => { const next = { ...prev }; delete next[name]; return next; });
      }
      if (lightbox && lightbox.name === name) setLightbox(null);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleDownload = (e, name, isGenerated) => {
    if (e) e.stopPropagation();
    const url = isGenerated ? `/api/media/file/generated/${name}` : `/api/media/file/${name}`;
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      });
  };

  const onDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // ─── Campaign Methods ───

  const loadCampaignDetails = async (id) => {
    try {
      const data = await api(`/api/media-ai/campaigns/${id}`);
      if (data) {
        setSelectedCampaign(data.campaign);
        setSelectedCampaignItems(data.items || []);
      }
    } catch (err) {
      console.error('Error loading campaign:', err);
    }
  };

  const handleDeleteCampaign = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this campaign?')) return;
    try {
      await api(`/api/media-ai/campaigns/${id}`, { method: 'DELETE' });
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (selectedCampaign?.id === id) {
        setSelectedCampaign(null);
        setSelectedCampaignItems([]);
      }
    } catch (err) {
      console.error('Delete campaign failed:', err);
    }
  };

  const handleGenerateCampaign = async () => {
    if (!campaignForm.projectName || !campaignForm.description) return;
    setIsGeneratingCampaign(true);
    try {
      const result = await api('/api/media-ai/generate-campaign', {
        method: 'POST',
        body: JSON.stringify(campaignForm),
      });
      if (result?.campaign) {
        setCampaigns(prev => [result.campaign, ...prev]);
        setSelectedCampaign(result.campaign);
        setSelectedCampaignItems(result.items || []);
        setCampaignForm(prev => ({ ...prev, description: '' }));
      }
    } catch (err) {
      alert('Campaign generation failed: ' + err.message);
    } finally {
      setIsGeneratingCampaign(false);
    }
  };

  const handleGenerateCampaignImage = async (itemId, prompt) => {
    setGeneratingImageId(itemId);
    try {
      const result = await api('/api/media-ai/generate-campaign-images', {
        method: 'POST',
        body: JSON.stringify({ itemId, prompt }),
      });
      if (result?.imagePath) {
        setSelectedCampaignItems(prev =>
          prev.map(item => item.id === itemId ? { ...item, image_path: result.imagePath } : item)
        );
      }
    } catch (err) {
      alert('Image generation failed: ' + err.message);
    } finally {
      setGeneratingImageId(null);
    }
  };

  // ─── Studio Methods (Job-based) ───

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const data = await api('/api/media-ai/jobs/active');
        const jobs = data?.jobs || [];
        setActiveJobs(jobs);
        if (jobs.length === 0) {
          stopPolling();
          // Refresh gallery after all jobs complete
          const updatedList = await api('/api/media/list/generated');
          if (Array.isArray(updatedList)) {
            setStudioImages(updatedList);
            updatedList.filter(f => f.type === 'image').forEach(f => fetchStudioImageBlob(f.name));
          }
        }
      } catch (_) {}
    }, 2500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleStudioGenerate = async () => {
    if (!studioForm.prompt) return;
    setIsGeneratingStudio(true);
    try {
      const result = await api('/api/media-ai/jobs', {
        method: 'POST',
        body: JSON.stringify(studioForm),
      });
      if (result?.jobId) {
        setActiveJobs(prev => [...prev, {
          id: result.jobId,
          type: 'studio',
          status: 'pending',
          prompt: studioForm.prompt,
          model: studioForm.model === 'quality' ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image',
          total_images: studioForm.quantity,
          completed_images: 0,
          failed_images: 0,
          _live: { status: 'pending', total: studioForm.quantity, completed: 0, failed: 0, percentage: 0 }
        }]);
        startPolling();
      }
      setStudioForm(prev => ({ ...prev, prompt: '' }));
    } catch (err) {
      alert('Image generation failed: ' + err.message);
    } finally {
      setIsGeneratingStudio(false);
    }
  };

  const handleCampaignBatchGenerate = async (campaignId) => {
    try {
      const result = await api('/api/media-ai/jobs/campaign-batch', {
        method: 'POST',
        body: JSON.stringify({ campaignId, model: studioForm.model }),
      });
      if (result?.jobId) {
        setActiveJobs(prev => [...prev, {
          id: result.jobId,
          type: 'campaign',
          status: 'pending',
          prompt: `Campaign batch`,
          _live: { status: 'pending', total: 0, completed: 0, failed: 0, percentage: 0 }
        }]);
        startPolling();
      }
    } catch (err) {
      alert('Batch generation failed: ' + err.message);
    }
  };

  const handleCopyToLibrary = async (filename) => {
    try {
      await api('/api/media/copy-to-library', {
        method: 'POST',
        body: JSON.stringify({ filename }),
      });
      await fetchMedia();
    } catch (err) {
      alert('Copy failed: ' + err.message);
    }
  };

  const handleDeleteGenerated = async (e, filename) => {
    if (e) e.stopPropagation();
    if (!confirm('Delete this generated image?')) return;
    try {
      await api(`/api/media/file/generated/${filename}`, { method: 'DELETE' });
      setStudioImages(prev => prev.filter(img => img.name !== filename));
      if (studioPreviews[filename]) {
        URL.revokeObjectURL(studioPreviews[filename]);
        setStudioPreviews(prev => { const next = { ...prev }; delete next[filename]; return next; });
      }
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  // ─── Shared Icons ───

  const typeIcons = {
    image: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
    video: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
    pdf: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    text: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    file: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>,
  };

  return (
    <div className="studio-container">
      <style>{`
        .studio-container {
          display: flex; flex-direction: column; height: calc(100vh - 60px);
          background: var(--bg); color: var(--text); overflow: hidden;
        }

        /* ─── TAB NAVIGATION ─── */
        .studio-tabs {
          display: flex; gap: 4px; padding: 12px 24px 0;
          border-bottom: 1px solid var(--border);
          background: rgba(10, 10, 10, 0.4); backdrop-filter: blur(10px);
          flex-shrink: 0;
        }
        .tab-btn {
          background: none; border: none; color: var(--text-muted);
          padding: 10px 18px; display: flex; align-items: center; gap: 8px;
          cursor: pointer; font-size: 13px; font-weight: 500;
          border-radius: var(--radius-sm) var(--radius-sm) 0 0;
          transition: var(--transition); border-bottom: 2px solid transparent;
        }
        .tab-btn:hover { color: var(--text); background: rgba(255,255,255,0.03); }
        .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
        .tab-btn svg { width: 16px; height: 16px; }

        .studio-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

        /* ─── LIBRARY TAB (existing styles) ─── */
        .library-content { flex: 1; overflow-y: auto; padding: 24px; max-width: 1200px; margin: 0 auto; width: 100%; }
        .media-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
        .media-header-left h2 { margin: 0; display: inline; }
        .media-badge { font-size: 12px; padding: 2px 10px; background: rgba(255,255,255,0.06); border-radius: 10px; margin-left: 10px; vertical-align: middle; color: var(--text-muted); }
        .media-subtitle { color: var(--text-muted); font-size: 13px; margin-top: 6px; }
        .media-upload-btn {
          display: flex; align-items: center; gap: 8px;
          background: var(--primary); color: white; border: none;
          padding: 8px 18px; border-radius: var(--radius-sm); font-weight: 600;
          cursor: pointer; font-size: 13px; transition: background var(--transition);
        }
        .media-upload-btn:hover { background: var(--primary-hover); }
        .media-upload-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .media-dropzone {
          border: 2px dashed var(--border); border-radius: var(--radius);
          padding: 32px; text-align: center; transition: all 0.2s ease;
          margin-bottom: 28px; cursor: pointer;
        }
        .media-dropzone.active { border-color: var(--primary); background: rgba(99, 102, 241, 0.05); }
        .media-dropzone:hover { border-color: rgba(255,255,255,0.12); }
        .media-dropzone-icon {
          width: 48px; height: 48px; border-radius: 50%;
          background: rgba(255,255,255,0.04); display: flex;
          align-items: center; justify-content: center; margin: 0 auto 12px;
          color: var(--text-muted);
        }
        .media-dropzone p { margin: 0; font-weight: 500; font-size: 14px; }
        .media-dropzone .hint { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
        .media-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px;
        }
        .media-card {
          background: rgba(255,255,255,0.025); border: 1px solid var(--border);
          border-radius: var(--radius); overflow: hidden; cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative;
        }
        .media-card:hover {
          transform: translateY(-3px); background: rgba(255,255,255,0.045);
          border-color: rgba(255,255,255,0.12); box-shadow: 0 12px 32px -8px rgba(0,0,0,0.5);
        }
        .media-card:hover .media-card-delete { opacity: 1; }
        .media-card-thumb {
          height: 160px; width: 100%; background: rgba(0,0,0,0.25);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; position: relative;
        }
        .media-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .media-card-icon { color: rgba(255,255,255,0.15); text-align: center; }
        .media-card-icon .ext { font-size: 10px; margin-top: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .media-card-eye {
          position: absolute; bottom: 8px; right: 8px;
          background: rgba(0,0,0,0.6); padding: 4px 6px; border-radius: 6px;
          color: white; display: flex; align-items: center; gap: 4px;
          font-size: 10px; font-weight: 600; backdrop-filter: blur(4px);
        }
        .media-card-delete {
          position: absolute; top: 8px; right: 8px; padding: 6px; border-radius: 8px;
          background: rgba(0,0,0,0.6); color: var(--danger);
          border: none; cursor: pointer; opacity: 0;
          transition: opacity 0.15s ease; backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
        }
        .media-card-delete:hover { background: rgba(239, 68, 68, 0.2); }
        .media-card-info { padding: 10px 12px; }
        .media-card-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .media-card-meta { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--text-dim); }
        .media-card-footer { padding: 8px 12px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; background: rgba(0,0,0,0.1); }
        .media-dl-btn {
          background: none; border: none; color: var(--primary); cursor: pointer;
          display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600;
          padding: 2px 4px; border-radius: 4px;
        }
        .media-dl-btn:hover { background: rgba(99, 102, 241, 0.1); }
        .media-empty {
          text-align: center; padding: 80px 32px; border: 1px solid var(--border);
          border-radius: var(--radius); background: rgba(255,255,255,0.01);
        }
        .media-empty svg { color: rgba(255,255,255,0.08); margin-bottom: 16px; }
        .media-empty h3 { font-size: 16px; margin: 0 0 6px; }
        .media-empty p { color: var(--text-muted); font-size: 13px; margin: 0; }
        .media-loading { display: flex; justify-content: center; padding: 80px; }
        .media-lightbox {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.92); z-index: 1000;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(12px); animation: lbIn 0.2s ease;
        }
        @keyframes lbIn { from { opacity: 0; } to { opacity: 1; } }
        .media-lightbox-close {
          position: absolute; top: 24px; right: 24px; background: none; border: none;
          color: white; cursor: pointer; padding: 8px; border-radius: 8px;
        }
        .media-lightbox-close:hover { background: rgba(255,255,255,0.1); }
        .media-lightbox-info { position: absolute; top: 24px; left: 28px; color: white; }
        .media-lightbox-info h3 { margin: 0; font-size: 16px; }
        .media-lightbox-info p { margin: 6px 0 0; opacity: 0.5; font-size: 13px; }
        .media-lightbox img { max-width: 90vw; max-height: 80vh; border-radius: 8px; box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
        .media-lightbox-dl {
          position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
          background: var(--primary); color: white; border: none; padding: 10px 28px;
          border-radius: 40px; font-weight: 600; cursor: pointer;
          display: flex; align-items: center; gap: 8px; font-size: 14px;
        }
        .media-lightbox-dl:hover { background: var(--primary-hover); }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .media-spin { animation: spin 1s linear infinite; }

        /* ─── CAMPAIGNS TAB ─── */
        .campaign-view { display: flex; flex: 1; overflow: hidden; }
        .campaign-sidebar {
          width: 280px; border-right: 1px solid var(--border);
          display: flex; flex-direction: column; background: rgba(255,255,255,0.01);
          flex-shrink: 0;
        }
        .sidebar-header {
          padding: 16px; display: flex; justify-content: space-between;
          align-items: center; border-bottom: 1px solid var(--border);
        }
        .sidebar-header h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0; }
        .count-badge { font-size: 10px; background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 10px; color: var(--text-muted); }
        .campaign-list { flex: 1; overflow-y: auto; padding: 8px; }
        .campaign-card-mini {
          padding: 12px; border-radius: var(--radius-sm);
          border: 1px solid transparent; cursor: pointer;
          margin-bottom: 4px; transition: var(--transition); position: relative;
        }
        .campaign-card-mini:hover { background: rgba(255,255,255,0.03); border-color: var(--border); }
        .campaign-card-mini.active { background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.3); }
        .campaign-card-mini:hover .campaign-card-del { opacity: 1; }
        .campaign-card-del {
          position: absolute; top: 8px; right: 8px; background: none; border: none;
          color: var(--text-dim); cursor: pointer; opacity: 0; transition: opacity 0.15s;
          padding: 2px; border-radius: 4px;
        }
        .campaign-card-del:hover { color: var(--danger); }
        .card-top { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .platform-tag {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          padding: 2px 6px; border-radius: 4px; color: white;
        }
        .platform-tag[data-platform="LinkedIn"] { background: #0077b5; }
        .platform-tag[data-platform="Twitter"] { background: #1da1f2; }
        .platform-tag[data-platform="Instagram"] { background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888); }
        .platform-tag[data-platform="Facebook"] { background: #1877f2; }
        .date-tag { font-size: 10px; color: var(--text-dim); }
        .card-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .empty-state-mini { color: var(--text-dim); font-size: 13px; text-align: center; padding: 32px 16px; }

        .campaign-main { flex: 1; overflow-y: auto; padding: 24px; }
        .generator-form-box {
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 24px; margin-bottom: 32px;
        }
        .section-title { font-size: 13px; font-weight: 600; margin-bottom: 20px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
        .form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
        .field.full { grid-column: span 2; }
        .field label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-muted); }
        .field select, .field textarea, .field input[type="range"] {
          width: 100%; background: var(--bg-input); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text); padding: 10px; font-size: 13px; outline: none;
        }
        .field textarea { height: 80px; resize: none; line-height: 1.5; font-family: inherit; }
        .field select:focus, .field textarea:focus { border-color: var(--primary); }
        .field-action { grid-column: span 2; display: flex; justify-content: flex-end; }
        .btn-generate {
          background: var(--primary); color: white; border: none;
          padding: 10px 24px; border-radius: var(--radius-sm); font-weight: 600;
          font-size: 13px; cursor: pointer; transition: var(--transition);
          display: flex; align-items: center; gap: 8px;
        }
        .btn-generate:hover:not(:disabled) { background: var(--primary-hover); }
        .btn-generate:disabled { opacity: 0.5; cursor: not-allowed; }

        .empty-state {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 80px 40px; color: var(--text-dim); text-align: center;
        }
        .empty-state svg { width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.15; }
        .loading-state {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 80px 40px; color: var(--text-muted);
        }
        .spinner {
          width: 32px; height: 32px; border: 2px solid rgba(255,255,255,0.1);
          border-top-color: var(--primary); border-radius: 50%;
          animation: spin 1s linear infinite; margin-bottom: 16px;
        }

        .results-header { margin-bottom: 24px; }
        .results-header h2 { font-size: 18px; margin: 0 0 8px 0; }
        .results-header .meta { display: flex; gap: 8px; align-items: center; }
        .post-grid { display: flex; flex-direction: column; gap: 20px; }
        .post-card {
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 20px;
        }
        .post-index { font-size: 10px; font-weight: 800; color: var(--primary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
        .post-content { font-size: 14px; line-height: 1.6; margin-bottom: 16px; white-space: pre-wrap; }
        .post-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
        .hashtag-badge { font-size: 11px; background: rgba(255,255,255,0.05); padding: 3px 8px; border-radius: 4px; color: var(--text-muted); }
        .post-visual {
          min-height: 120px; border: 1px dashed var(--border); border-radius: var(--radius-sm);
          overflow: hidden; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.1);
        }
        .image-preview-wrapper { width: 100%; position: relative; }
        .image-preview-wrapper img { width: 100%; height: auto; display: block; }
        .refresh-img {
          position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6);
          border: none; color: white; font-size: 11px; padding: 4px 10px; border-radius: 4px;
          cursor: pointer; backdrop-filter: blur(4px);
        }
        .refresh-img:hover { background: rgba(0,0,0,0.8); }
        .image-placeholder-cta button {
          background: none; border: 1px solid var(--border); color: var(--primary);
          font-size: 13px; font-weight: 600; cursor: pointer; display: flex;
          align-items: center; gap: 8px; padding: 10px 20px; border-radius: var(--radius-sm);
          transition: var(--transition);
        }
        .image-placeholder-cta button:hover { border-color: var(--primary); background: rgba(99, 102, 241, 0.05); }
        .image-placeholder-cta button:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ─── IMAGE STUDIO TAB ─── */
        .studio-view { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
        .studio-header {
          padding: 24px; background: var(--bg-card);
          border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .studio-form-row { display: flex; gap: 24px; align-items: flex-start; }
        .prompt-area { flex: 1; }
        .prompt-area textarea {
          width: 100%; height: 90px; background: var(--bg-input);
          border: 1px solid var(--border); border-radius: var(--radius);
          padding: 16px; color: var(--text); font-size: 14px; resize: none;
          outline: none; font-family: inherit; line-height: 1.5;
        }
        .prompt-area textarea:focus { border-color: var(--primary); }
        .studio-controls { width: 300px; display: flex; flex-direction: column; gap: 14px; flex-shrink: 0; }
        .control-group label {
          display: block; font-size: 11px; font-weight: 700;
          text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;
        }
        .ratio-toggle {
          display: flex; gap: 4px; background: var(--bg-input);
          padding: 4px; border-radius: var(--radius-sm); border: 1px solid var(--border);
        }
        .ratio-toggle button {
          flex: 1; background: none; border: none; color: var(--text-muted);
          padding: 6px; font-size: 11px; font-weight: 600; cursor: pointer;
          border-radius: 4px; transition: var(--transition);
        }
        .ratio-toggle button.active { background: rgba(255,255,255,0.08); color: var(--text); }
        .studio-controls select {
          width: 100%; background: var(--bg-input); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 8px; color: var(--text); font-size: 13px; outline: none;
        }
        .btn-studio-generate {
          background: linear-gradient(135deg, var(--primary), #8b5cf6);
          color: white; border: none; padding: 12px; border-radius: var(--radius-sm);
          font-weight: 700; font-size: 13px; cursor: pointer; transition: var(--transition);
        }
        .btn-studio-generate:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .btn-studio-generate:disabled { opacity: 0.5; cursor: not-allowed; }

        .studio-gallery { flex: 1; overflow-y: auto; padding: 24px; position: relative; }
        .gallery-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px;
        }
        .gallery-item {
          aspect-ratio: 1; border-radius: var(--radius); overflow: hidden;
          background: var(--bg-card); border: 1px solid var(--border);
          position: relative; transition: var(--transition);
        }
        .gallery-item:hover { border-color: rgba(255,255,255,0.12); }
        .gallery-item img { width: 100%; height: 100%; object-fit: cover; }
        .item-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,0.65);
          display: flex; flex-direction: column; justify-content: center; align-items: center;
          opacity: 0; transition: 0.2s ease; backdrop-filter: blur(4px);
        }
        .gallery-item:hover .item-overlay { opacity: 1; }
        .overlay-actions { display: flex; gap: 12px; }
        .overlay-actions button, .overlay-actions a {
          width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.9);
          color: #111; display: flex; align-items: center; justify-content: center;
          cursor: pointer; border: none; transition: 0.2s; text-decoration: none;
        }
        .overlay-actions button:hover, .overlay-actions a:hover { transform: scale(1.1); }
        .overlay-actions button.danger:hover { background: var(--danger); color: white; }
        .overlay-info { position: absolute; bottom: 10px; left: 12px; right: 12px; text-align: center; }
        .file-name { font-size: 10px; color: rgba(255,255,255,0.6); }

        .studio-loading-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,0.5); z-index: 10;
          display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px);
        }
        .loading-content { text-align: center; color: white; }

        /* ─── MODEL TOGGLE ─── */
        .model-toggle {
          display: flex; gap: 4px; background: var(--bg-input);
          padding: 4px; border-radius: var(--radius-sm); border: 1px solid var(--border);
        }
        .model-toggle button {
          flex: 1; background: none; border: none; color: var(--text-muted);
          padding: 6px 12px; font-size: 11px; font-weight: 600; cursor: pointer;
          border-radius: 4px; transition: var(--transition); white-space: nowrap;
        }
        .model-toggle button.active { background: rgba(255,255,255,0.08); color: var(--text); }
        .model-toggle button .model-dot {
          display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px;
        }

        /* ─── JOBS PROGRESS SECTION ─── */
        .jobs-progress { padding: 16px 24px 0; flex-shrink: 0; }
        .jobs-progress-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 12px;
        }
        .jobs-grid { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
        .job-card {
          min-width: 260px; max-width: 320px; flex-shrink: 0;
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 16px;
          transition: var(--transition);
        }
        .job-card:hover { border-color: var(--border-light); }
        .job-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        .job-percentage { font-size: 28px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
        .job-percentage.processing { color: var(--primary); }
        .job-percentage.completed { color: var(--success); }
        .job-percentage.failed { color: var(--danger); }
        .job-percentage.pending { color: var(--warning); }
        .job-badges { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
        .job-status-badge {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.05em; padding: 2px 8px; border-radius: 10px;
        }
        .job-status-badge.pending { background: var(--warning-glow); color: var(--warning); }
        .job-status-badge.processing { background: var(--primary-glow); color: var(--primary); }
        .job-status-badge.completed { background: var(--success-glow); color: var(--success); }
        .job-status-badge.failed { background: var(--danger-glow); color: var(--danger); }
        .job-model-badge {
          font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 4px;
          background: rgba(255,255,255,0.04); color: var(--text-dim);
        }
        .job-prompt {
          font-size: 12px; color: var(--text-muted); margin-bottom: 12px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .job-progress-bar {
          height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px;
          overflow: hidden; margin-bottom: 8px;
        }
        .job-progress-fill {
          height: 100%; border-radius: 2px; transition: width 0.5s ease;
        }
        .job-progress-fill.processing { background: var(--primary); animation: progressPulse 2s ease-in-out infinite; }
        .job-progress-fill.completed { background: var(--success); }
        .job-progress-fill.failed { background: var(--danger); }
        .job-progress-fill.pending { background: var(--warning); }
        .job-counter {
          font-size: 11px; color: var(--text-dim); font-variant-numeric: tabular-nums;
        }

        @keyframes progressPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        @media (max-width: 1024px) {
          .studio-form-row { flex-direction: column; }
          .studio-controls { width: 100%; }
          .campaign-sidebar { display: none; }
        }
        @media (max-width: 768px) {
          .media-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
          .media-card-thumb { height: 120px; }
          .media-header { flex-direction: column; align-items: flex-start; }
          .gallery-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      {/* TAB NAVIGATION */}
      <nav className="studio-tabs">
        <button className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          <span>Library</span>
        </button>
        <button className={`tab-btn ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => setActiveTab('campaigns')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 11H5M19 11C20.1 11 21 11.9 21 13V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V13C3 11.9 3.9 11 5 11M19 11V9C19 7.9 18.1 7 17 7M5 11V9C5 7.9 5.9 7 7 7M7 7V5C7 3.9 7.9 3 9 3H15C16.1 3 17 3.9 17 5V7M7 7H17"/></svg>
          <span>Campaigns</span>
        </button>
        <button className={`tab-btn ${activeTab === 'studio' ? 'active' : ''}`} onClick={() => setActiveTab('studio')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7L12 12L22 7L12 2Z"/><path d="M2 17L12 22L22 17"/><path d="M2 12L12 17L22 12"/></svg>
          <span>Image Studio</span>
        </button>
      </nav>

      <div className="studio-body">
        {/* ─── TAB 1: LIBRARY ─── */}
        {activeTab === 'library' && (
          <div className="library-content">
            <div className="media-header">
              <div className="media-header-left">
                <h2 className="page-title">Media</h2>
                <span className="media-badge">{files.length} file{files.length !== 1 ? 's' : ''}</span>
                <p className="media-subtitle">Assets, screenshots and exports stored on your instance.</p>
              </div>
              <button className="media-upload-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? (
                  <><svg className="media-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>Uploading...</>
                ) : (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload</>
                )}
              </button>
            </div>

            <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => handleUpload(e.target.files)} />

            <div
              className={`media-dropzone${dragActive ? ' active' : ''}`}
              onDragEnter={onDrag} onDragLeave={onDrag} onDragOver={onDrag} onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="media-dropzone-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <p>Drop files here to upload</p>
              <p className="hint">Images, videos, PDFs and text files supported</p>
            </div>

            {loading ? (
              <div className="media-loading">
                <svg className="media-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              </div>
            ) : files.length === 0 ? (
              <div className="media-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                <h3>No media files</h3>
                <p>Upload files to see them in your gallery.</p>
              </div>
            ) : (
              <div className="media-grid">
                {files.map((file) => (
                  <div key={file.name} className="media-card" onClick={() => { if (file.type === 'image') setLightbox(file); else handleDownload(null, file.name); }}>
                    <button className="media-card-delete" onClick={(e) => handleDelete(e, file.name)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                    <div className="media-card-thumb">
                      {file.type === 'image' && previews[file.name] ? (
                        <>
                          <img src={previews[file.name]} alt={file.name} />
                          <div className="media-card-eye">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            Preview
                          </div>
                        </>
                      ) : (
                        <div className="media-card-icon">
                          {typeIcons[file.type] || typeIcons.file}
                          <div className="ext">.{file.ext}</div>
                        </div>
                      )}
                    </div>
                    <div className="media-card-info">
                      <div className="media-card-name" title={file.name}>{file.name}</div>
                      <div className="media-card-meta">
                        <span>{formatSize(file.size)}</span>
                        <span>{new Date(file.modified).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="media-card-footer">
                      <button className="media-dl-btn" onClick={(e) => handleDownload(e, file.name)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 2: CAMPAIGNS ─── */}
        {activeTab === 'campaigns' && (
          <div className="campaign-view">
            <aside className="campaign-sidebar">
              <div className="sidebar-header">
                <h3>History</h3>
                <span className="count-badge">{campaigns.length}</span>
              </div>
              <div className="campaign-list">
                {campaigns.length === 0 ? (
                  <div className="empty-state-mini">No campaigns yet</div>
                ) : (
                  campaigns.map(c => (
                    <div
                      key={c.id}
                      className={`campaign-card-mini ${selectedCampaign?.id === c.id ? 'active' : ''}`}
                      onClick={() => loadCampaignDetails(c.id)}
                    >
                      <button className="campaign-card-del" onClick={(e) => handleDeleteCampaign(e, c.id)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                      <div className="card-top">
                        <span className="platform-tag" data-platform={c.platform}>{c.platform}</span>
                        <span className="date-tag">{new Date(c.created_at * 1000).toLocaleDateString()}</span>
                      </div>
                      <div className="card-title">{c.campaign_data?.title || c.description?.slice(0, 50) || 'Untitled'}</div>
                    </div>
                  ))
                )}
              </div>
            </aside>

            <main className="campaign-main">
              <section className="generator-form-box">
                <div className="section-title">New Campaign</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Reference Project</label>
                    <select
                      value={campaignForm.projectName}
                      onChange={(e) => setCampaignForm({...campaignForm, projectName: e.target.value})}
                    >
                      <option value="">Select a RAG-indexed project...</option>
                      {projects.map(p => <option key={p.project_name} value={p.project_name}>{p.project_name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Platform</label>
                    <select
                      value={campaignForm.platform}
                      onChange={(e) => setCampaignForm({...campaignForm, platform: e.target.value})}
                    >
                      <option>LinkedIn</option>
                      <option>Twitter</option>
                      <option>Instagram</option>
                      <option>Facebook</option>
                    </select>
                  </div>
                  <div className="field full">
                    <label>Campaign Brief</label>
                    <textarea
                      placeholder="Describe your campaign goals, target audience, key messages..."
                      value={campaignForm.description}
                      onChange={(e) => setCampaignForm({...campaignForm, description: e.target.value})}
                    />
                  </div>
                  <div className="field">
                    <label>Number of posts: {campaignForm.imageCount}</label>
                    <input
                      type="range" min="1" max="10"
                      value={campaignForm.imageCount}
                      onChange={(e) => setCampaignForm({...campaignForm, imageCount: parseInt(e.target.value)})}
                    />
                  </div>
                  <div className="field-action">
                    <button
                      className="btn-generate"
                      onClick={handleGenerateCampaign}
                      disabled={isGeneratingCampaign || !campaignForm.projectName || !campaignForm.description}
                    >
                      {isGeneratingCampaign ? (
                        <><svg className="media-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>Generating...</>
                      ) : (
                        'Generate Campaign'
                      )}
                    </button>
                  </div>
                </div>
              </section>

              <section>
                {!selectedCampaign && !isGeneratingCampaign && (
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 4L12 1L9 4M4 15L1 12L4 9M9 20L12 23L15 20M20 9L23 12L20 15M12 8C9.8 8 8 9.8 8 12C8 14.2 9.8 16 12 16C14.2 16 16 14.2 16 12C16 9.8 14.2 8 12 8Z"/></svg>
                    <p>Select a campaign from history or create a new one.</p>
                  </div>
                )}

                {isGeneratingCampaign && (
                  <div className="loading-state">
                    <div className="spinner"></div>
                    <p>AI is crafting your campaign...</p>
                  </div>
                )}

                {/* Campaign batch progress */}
                {activeJobs.filter(j => j.type === 'campaign').length > 0 && (
                  <div className="jobs-progress" style={{ padding: '0 0 20px' }}>
                    <div className="jobs-progress-title">Image Generation Progress</div>
                    <div className="jobs-grid">
                      {activeJobs.filter(j => j.type === 'campaign').map(job => {
                        const live = job._live || {};
                        const pct = live.percentage || 0;
                        const status = live.status || job.status || 'pending';
                        const completed = live.completed || job.completed_images || 0;
                        const failed = live.failed || job.failed_images || 0;
                        const total = job.total_images || 1;
                        return (
                          <div key={job.id} className="job-card" style={{ maxWidth: '100%', minWidth: 'auto', width: '100%' }}>
                            <div className="job-card-top">
                              <span className={`job-percentage ${status}`}>{pct}%</span>
                              <span className={`job-status-badge ${status}`}>{status}</span>
                            </div>
                            <div className="job-progress-bar">
                              <div className={`job-progress-fill ${status}`} style={{ width: `${pct}%` }}></div>
                            </div>
                            <div className="job-counter">{completed} / {total} images{failed > 0 ? ` (${failed} failed)` : ''}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedCampaign && !isGeneratingCampaign && (
                  <div className="campaign-results">
                    <div className="results-header">
                      <h2>{selectedCampaign.campaign_data?.title || 'Campaign'}</h2>
                      <div className="meta">
                        <span className="platform-tag" data-platform={selectedCampaign.platform}>{selectedCampaign.platform}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{selectedCampaign.project_name}</span>
                        <button
                          className="btn-generate"
                          style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: '12px' }}
                          onClick={() => handleCampaignBatchGenerate(selectedCampaign.id)}
                          disabled={activeJobs.some(j => j.type === 'campaign')}
                        >
                          {activeJobs.some(j => j.type === 'campaign') ? 'Generating...' : 'Generate All Images'}
                        </button>
                      </div>
                    </div>

                    <div className="post-grid">
                      {selectedCampaignItems.map((item, idx) => (
                        <div key={item.id} className="post-card">
                          <div className="post-index">Post #{idx + 1}</div>
                          <div className="post-content">{item.content}</div>
                          {item.metadata?.hashtags && item.metadata.hashtags.length > 0 && (
                            <div className="post-tags">
                              {item.metadata.hashtags.map((t, i) => (
                                <span key={i} className="hashtag-badge">{t.startsWith('#') ? t : `#${t}`}</span>
                              ))}
                            </div>
                          )}
                          <div className="post-visual">
                            {item.image_path ? (
                              <div className="image-preview-wrapper">
                                <CampaignImage imagePath={item.image_path} />
                                <button className="refresh-img" onClick={() => handleGenerateCampaignImage(item.id, item.image_prompt)}>
                                  Regenerate
                                </button>
                              </div>
                            ) : (
                              <div className="image-placeholder-cta">
                                <button
                                  onClick={() => handleGenerateCampaignImage(item.id, item.image_prompt)}
                                  disabled={generatingImageId === item.id}
                                >
                                  {generatingImageId === item.id ? (
                                    <><svg className="media-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>Generating...</>
                                  ) : (
                                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>Generate Visual</>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </main>
          </div>
        )}

        {/* ─── TAB 3: IMAGE STUDIO ─── */}
        {activeTab === 'studio' && (
          <div className="studio-view">
            <header className="studio-header">
              <div className="studio-form-row">
                <div className="prompt-area">
                  <textarea
                    placeholder="Describe the image you want to generate..."
                    value={studioForm.prompt}
                    onChange={(e) => setStudioForm({...studioForm, prompt: e.target.value})}
                  />
                </div>
                <div className="studio-controls">
                  <div className="control-group">
                    <label>Aspect Ratio</label>
                    <div className="ratio-toggle">
                      {['1:1', '16:9', '9:16'].map(r => (
                        <button
                          key={r}
                          className={studioForm.aspectRatio === r ? 'active' : ''}
                          onClick={() => setStudioForm({...studioForm, aspectRatio: r})}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="control-group">
                    <label>Model</label>
                    <div className="model-toggle">
                      <button
                        className={studioForm.model === 'fast' ? 'active' : ''}
                        onClick={() => setStudioForm({...studioForm, model: 'fast'})}
                      >
                        <span className="model-dot" style={{ background: 'var(--success)' }}></span>Fast
                      </button>
                      <button
                        className={studioForm.model === 'quality' ? 'active' : ''}
                        onClick={() => setStudioForm({...studioForm, model: 'quality'})}
                      >
                        <span className="model-dot" style={{ background: 'var(--primary)' }}></span>Quality
                      </button>
                    </div>
                  </div>
                  <div className="control-group">
                    <label>Quantity</label>
                    <select
                      value={studioForm.quantity}
                      onChange={(e) => setStudioForm({...studioForm, quantity: parseInt(e.target.value)})}
                    >
                      {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} image{n > 1 ? 's' : ''}</option>)}
                    </select>
                  </div>
                  <button
                    className="btn-studio-generate"
                    onClick={handleStudioGenerate}
                    disabled={isGeneratingStudio || !studioForm.prompt}
                  >
                    {isGeneratingStudio ? 'Generating...' : 'Generate Images'}
                  </button>
                </div>
              </div>
            </header>

            {activeJobs.filter(j => j.type === 'studio').length > 0 && (
              <div className="jobs-progress">
                <div className="jobs-progress-title">Active Generations</div>
                <div className="jobs-grid">
                  {activeJobs.filter(j => j.type === 'studio').map(job => {
                    const live = job._live || {};
                    const pct = live.percentage || 0;
                    const status = live.status || job.status || 'pending';
                    const completed = live.completed || job.completed_images || 0;
                    const failed = live.failed || job.failed_images || 0;
                    const total = job.total_images || 1;
                    const modelShort = (job.model || '').includes('pro') ? 'Quality' : 'Fast';
                    return (
                      <div key={job.id} className="job-card">
                        <div className="job-card-top">
                          <span className={`job-percentage ${status}`}>{pct}%</span>
                          <div className="job-badges">
                            <span className={`job-status-badge ${status}`}>{status}</span>
                            <span className="job-model-badge">{modelShort}</span>
                          </div>
                        </div>
                        <div className="job-prompt" title={job.prompt}>{(job.prompt || '').slice(0, 60)}{(job.prompt || '').length > 60 ? '...' : ''}</div>
                        <div className="job-progress-bar">
                          <div className={`job-progress-fill ${status}`} style={{ width: `${pct}%` }}></div>
                        </div>
                        <div className="job-counter">{completed} / {total} images{failed > 0 ? ` (${failed} failed)` : ''}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <main className="studio-gallery">
              {studioImages.length === 0 && activeJobs.filter(j => j.type === 'studio').length === 0 ? (
                <div className="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7L12 12L22 7L12 2Z"/><path d="M2 17L12 22L22 17"/><path d="M2 12L12 17L22 12"/></svg>
                  <p>Your generated images will appear here.</p>
                </div>
              ) : (
                <div className="gallery-grid">
                  {studioImages.map((img) => (
                    <div key={img.name} className="gallery-item">
                      {studioPreviews[img.name] ? (
                        <img src={studioPreviews[img.name]} alt={img.name} />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                          <svg className="media-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                        </div>
                      )}
                      <div className="item-overlay">
                        <div className="overlay-actions">
                          <button onClick={() => handleCopyToLibrary(img.name)} title="Save to Library">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 4V16C8 17.1 8.9 18 10 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2H10C8.9 2 8 2.9 8 4Z"/><path d="M16 22H4C2.9 22 2 21.1 2 20V8"/></svg>
                          </button>
                          <button onClick={() => handleDownload(null, img.name, true)} title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          </button>
                          <button className="danger" onClick={(e) => handleDeleteGenerated(e, img.name)} title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                          </button>
                        </div>
                        <div className="overlay-info">
                          <span className="file-name">{img.name}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </main>
          </div>
        )}
      </div>

      {/* ─── LIGHTBOX (Library) ─── */}
      {lightbox && (
        <div className="media-lightbox" onClick={() => setLightbox(null)}>
          <button className="media-lightbox-close" onClick={() => setLightbox(null)}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div className="media-lightbox-info">
            <h3>{lightbox.name}</h3>
            <p>{formatSize(lightbox.size)} &middot; {new Date(lightbox.modified).toLocaleString()}</p>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <img src={previews[lightbox.name]} alt={lightbox.name} />
          </div>
          <button className="media-lightbox-dl" onClick={(e) => handleDownload(e, lightbox.name)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
        </div>
      )}
    </div>
  );
}

// Helper component for campaign images with auth
function CampaignImage({ imagePath }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    const name = imagePath.replace('generated/', '');
    fetch(`/api/media/file/generated/${name}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(res => res.blob())
      .then(blob => setSrc(URL.createObjectURL(blob)))
      .catch(() => {});
    return () => { if (src) URL.revokeObjectURL(src); };
  }, [imagePath]);

  if (!src) return <div style={{ padding: '20px', color: 'var(--text-dim)' }}>Loading image...</div>;
  return <img src={src} alt="Campaign visual" style={{ width: '100%', height: 'auto' }} />;
}
