/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useCallback, ChangeEvent, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { mixImageStyle, editImageWithPrompt } from '../services/geminiService';
import ActionablePolaroidCard from './ActionablePolaroidCard';
import Lightbox from './Lightbox';
import { 
    AppScreenHeader,
    handleFileUpload,
    useMediaQuery,
    ImageForZip,
    Slider,
    ResultsView,
    type MixStyleState,
    useLightbox,
    useVideoGeneration,
    processAndDownloadAll,
    PromptResultCard,
    useAppControls,
    embedJsonInPng,
    getInitialStateForApp,
} from './uiUtils';

interface MixStyleProps {
    mainTitle: string;
    subtitle: string;
    useSmartTitleWrapping: boolean;
    smartTitleWrapWords: number;
    uploaderCaptionContent: string;
    uploaderDescriptionContent: string;
    uploaderCaptionStyle: string;
    uploaderDescriptionStyle: string;
    addImagesToGallery: (images: string[]) => void;
    appState: MixStyleState;
    onStateChange: (newState: MixStyleState) => void;
    onReset: () => void;
    onGoBack: () => void;
    logGeneration: (appId: string, preGenState: any, thumbnailUrl: string) => void;
}

const STYLE_STRENGTH_OPTIONS = ['Rất yếu', 'Yếu', 'Trung bình', 'Mạnh', 'Rất mạnh'] as const;

const MixStyle: React.FC<MixStyleProps> = (props) => {
    const { 
        uploaderCaptionContent, uploaderDescriptionContent,
        uploaderCaptionStyle, uploaderDescriptionStyle,
        addImagesToGallery,
        appState, onStateChange, onReset,
        logGeneration,
        ...headerProps
    } = props;

    const { t, settings } = useAppControls();
    const { lightboxIndex, openLightbox, closeLightbox, navigateLightbox } = useLightbox();
    const { videoTasks, generateVideo } = useVideoGeneration();
    const isMobile = useMediaQuery('(max-width: 768px)');
    const [localNotes, setLocalNotes] = useState(appState.options.notes);

    useEffect(() => {
        setLocalNotes(appState.options.notes);
    }, [appState.options.notes]);

    const lightboxImages = [appState.contentImage, appState.styleImage, ...appState.historicalImages].filter((img): img is string => !!img);

    const handleContentImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        handleFileUpload(e, (imageDataUrl) => {
            onStateChange({
                ...appState,
                stage: appState.styleImage ? 'configuring' : 'idle',
                contentImage: imageDataUrl,
                generatedImage: null,
                historicalImages: [],
                finalPrompt: null,
                error: null,
            });
            addImagesToGallery([imageDataUrl]);
        });
    };

    const handleStyleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        handleFileUpload(e, (imageDataUrl) => {
            onStateChange({
                ...appState,
                stage: appState.contentImage ? 'configuring' : 'idle',
                styleImage: imageDataUrl,
                generatedImage: null,
                historicalImages: [],
                finalPrompt: null,
                error: null,
            });
            addImagesToGallery([imageDataUrl]);
        });
    };
    
    const handleContentImageChange = (newUrl: string) => {
        onStateChange({
            ...appState,
            stage: appState.styleImage ? 'configuring' : 'idle',
            contentImage: newUrl,
        });
        addImagesToGallery([newUrl]);
    };
    const handleStyleImageChange = (newUrl: string) => {
        onStateChange({
            ...appState,
            stage: appState.contentImage ? 'configuring' : 'idle',
            styleImage: newUrl,
        });
        addImagesToGallery([newUrl]);
    };
    const handleGeneratedImageChange = (newUrl: string) => {
        const newHistorical = [...appState.historicalImages, newUrl];
        onStateChange({ ...appState, stage: 'results', generatedImage: newUrl, historicalImages: newHistorical });
        addImagesToGallery([newUrl]);
    };

    const handleOptionChange = (field: keyof MixStyleState['options'], value: string | boolean) => {
        onStateChange({
            ...appState,
            options: { ...appState.options, [field]: value },
        });
    };

    const executeInitialGeneration = async () => {
        if (!appState.contentImage || !appState.styleImage) return;

        const preGenState = { ...appState };
        onStateChange({ ...appState, stage: 'generating', error: null, finalPrompt: null });

        try {
            const { resultUrl, finalPrompt } = await mixImageStyle(
                appState.contentImage, 
                appState.styleImage, 
                appState.options
            );
            const settingsToEmbed = {
                viewId: 'mix-style',
                state: { ...appState, stage: 'configuring', generatedImage: null, historicalImages: [], finalPrompt: null, error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            logGeneration('mix-style', preGenState, urlWithMetadata);
            onStateChange({ 
                ...appState, 
                stage: 'results', 
                generatedImage: urlWithMetadata, 
                historicalImages: [...appState.historicalImages, urlWithMetadata],
                finalPrompt: finalPrompt,
            });
            addImagesToGallery([urlWithMetadata]);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            onStateChange({ ...appState, stage: 'results', error: errorMessage });
        }
    };

    const handleRegeneration = async (prompt: string, aspectRatio: string) => {
        if (!appState.generatedImage) return;

        const preGenState = { ...appState };
        onStateChange({ ...appState, stage: 'generating', error: null });

        try {
            const resultUrl = await editImageWithPrompt(appState.generatedImage, prompt, aspectRatio, appState.options.removeWatermark);
            const settingsToEmbed = {
                viewId: 'mix-style',
                state: { ...appState, stage: 'configuring', generatedImage: null, historicalImages: [], finalPrompt: null, error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            logGeneration('mix-style', preGenState, urlWithMetadata);
            onStateChange({
                ...appState,
                stage: 'results',
                generatedImage: urlWithMetadata,
                historicalImages: [...appState.historicalImages, urlWithMetadata],
                finalPrompt: prompt,
            });
            addImagesToGallery([urlWithMetadata]);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            onStateChange({ ...appState, stage: 'results', error: errorMessage });
        }
    };

    const handleBackToOptions = () => {
        onStateChange({ ...appState, stage: 'configuring', error: null });
    };

    const handleDownloadAll = () => {
        const inputImages: ImageForZip[] = [];
        if (appState.contentImage) {
            inputImages.push({ url: appState.contentImage, filename: 'anh-noi-dung', folder: 'input' });
        }
        if (appState.styleImage) {
            inputImages.push({ url: appState.styleImage, filename: 'anh-style', folder: 'input' });
        }
        
        processAndDownloadAll({
            inputImages,
            historicalImages: appState.historicalImages,
            videoTasks,
            zipFilename: 'ket-qua-tron-style.zip',
            baseOutputFilename: 'ket-qua-tron-style',
        });
    };

    const Uploader = ({ id, onUpload, caption, description, currentImage, onImageChange, placeholderType, cardType }: any) => (
        <div className="flex flex-col items-center gap-4">
            <ActionablePolaroidCard
                type={currentImage ? cardType : 'uploader'}
                caption={caption}
                status="done"
                mediaUrl={currentImage || undefined}
                placeholderType={placeholderType}
                onClick={currentImage ? () => openLightbox(lightboxImages.indexOf(currentImage)) : undefined}
                onImageChange={onImageChange}
            />
            {description && <p className="base-font font-bold text-neutral-300 text-center max-w-xs text-md">{description}</p>}
        </div>
    );
    
    const isLoading = appState.stage === 'generating';

    return (
        <div className="flex flex-col items-center justify-center w-full h-full flex-1 min-h-0">
            <AnimatePresence>
                {(appState.stage === 'idle' || appState.stage === 'configuring') && (<AppScreenHeader {...headerProps} />)}
            </AnimatePresence>

            {appState.stage === 'idle' && (
                <div className="w-full overflow-x-auto pb-4">
                    <motion.div
                        className="flex flex-col md:flex-row items-center md:items-start justify-center gap-6 md:gap-8 w-full md:w-max mx-auto px-4"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <Uploader id="content-upload" onUpload={handleContentImageUpload} onImageChange={handleContentImageChange} caption={uploaderCaptionContent} description={uploaderDescriptionContent} currentImage={appState.contentImage} placeholderType="magic" cardType="content-input" />
                        <Uploader id="style-upload" onUpload={handleStyleImageUpload} onImageChange={handleStyleImageChange} caption={uploaderCaptionStyle} description={uploaderDescriptionStyle} currentImage={appState.styleImage} placeholderType="style" cardType="style-input" />
                    </motion.div>
                </div>
            )}

            {appState.stage === 'configuring' && appState.contentImage && appState.styleImage && (
                <motion.div 
                    className="flex flex-col items-center gap-8 w-full max-w-screen-xl mx-auto py-6" 
                    initial={{ opacity: 0, y: 20 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ duration: 0.5 }}
                >
                    <div className="w-full overflow-x-auto pb-4">
                        <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8 w-full md:w-max mx-auto px-4">
                            <ActionablePolaroidCard type="content-input" mediaUrl={appState.contentImage} caption={t('mixStyle_contentCaption')} status="done" onClick={() => appState.contentImage && openLightbox(lightboxImages.indexOf(appState.contentImage))} onImageChange={handleContentImageChange} />
                            <ActionablePolaroidCard type="style-input" mediaUrl={appState.styleImage} caption={t('mixStyle_styleCaption')} status="done" onClick={() => appState.styleImage && openLightbox(lightboxImages.indexOf(appState.styleImage))} onImageChange={handleStyleImageChange} />
                        </div>
                    </div>

                    <div className="w-full flex flex-col lg:flex-row items-start justify-center gap-8 px-4">
                        <div className="w-full max-w-md bg-black/20 p-6 rounded-lg border border-white/10 space-y-4">
                            <h2 className="base-font font-bold text-2xl text-yellow-400 border-b border-yellow-400/20 pb-2">{t('common_options')}</h2>
                            <Slider
                                label={t('mixStyle_strengthLabel')}
                                options={STYLE_STRENGTH_OPTIONS}
                                value={appState.options.styleStrength}
                                onChange={(value) => handleOptionChange('styleStrength', value)}
                            />
                            <div>
                                <label htmlFor="notes" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('common_additionalNotes')}</label>
                                <textarea id="notes" value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} onBlur={() => { if (localNotes !== appState.options.notes) { handleOptionChange('notes', localNotes); } }} placeholder={t('mixStyle_notesPlaceholder')} className="form-input h-24" rows={3} />
                            </div>
                            <div className="flex items-center pt-2">
                                <input type="checkbox" id="remove-watermark-mix" checked={appState.options.removeWatermark} onChange={(e) => handleOptionChange('removeWatermark', e.target.checked)} className="h-4 w-4 rounded border-neutral-500 bg-neutral-700 text-yellow-400 focus:ring-yellow-400 focus:ring-offset-neutral-800" />
                                <label htmlFor="remove-watermark-mix" className="ml-3 block text-sm font-medium text-neutral-300">{t('common_removeWatermark')}</label>
                            </div>
                            <div className="flex items-center justify-end gap-4 pt-4">
                                <button onClick={onReset} className="btn btn-secondary">{t('common_changeImage')}</button>
                                <button onClick={executeInitialGeneration} className="btn btn-primary" disabled={isLoading}>{isLoading ? t('mixStyle_creating') : t('mixStyle_createButton')}</button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
            
            {(appState.stage === 'generating' || appState.stage === 'results') && (
                <ResultsView stage={appState.stage} originalImage={appState.contentImage} onOriginalClick={() => appState.contentImage && openLightbox(lightboxImages.indexOf(appState.contentImage))} error={appState.error} isMobile={isMobile} actions={
                    <>
                        {appState.generatedImage && !appState.error && (<button onClick={handleDownloadAll} className="btn btn-secondary">{t('common_downloadAll')}</button>)}
                        <button onClick={handleBackToOptions} className="btn btn-secondary">{t('common_editOptions')}</button>
                        <button onClick={onReset} className="btn btn-secondary">{t('common_startOver')}</button>
                    </>
                }>
                    {appState.styleImage && (
                        <motion.div key="style" className="w-full md:w-auto flex-shrink-0" whileHover={{ scale: 1.05, zIndex: 10 }} transition={{ duration: 0.2 }}>
                            <ActionablePolaroidCard type="style-input" caption={t('mixStyle_styleCaption')} status="done" mediaUrl={appState.styleImage} isMobile={isMobile} onClick={() => appState.styleImage && openLightbox(lightboxImages.indexOf(appState.styleImage))} onImageChange={handleStyleImageChange} />
                        </motion.div>
                    )}
                    <motion.div className="w-full md:w-auto flex-shrink-0" key="generated-mix" initial={{ opacity: 0, scale: 0.5, y: 100 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 80, damping: 15, delay: 0.2 }} whileHover={{ scale: 1.05, zIndex: 10 }}>
                        <ActionablePolaroidCard
                            type="output"
                            caption={t('common_result')}
                            status={isLoading ? 'pending' : (appState.error ? 'error' : 'done')}
                            mediaUrl={appState.generatedImage ?? undefined} error={appState.error ?? undefined}
                            onImageChange={handleGeneratedImageChange}
                            onRegenerate={handleRegeneration}
                            onGenerateVideoFromPrompt={(prompt) => appState.generatedImage && generateVideo(appState.generatedImage, prompt)}
                            regenerationTitle={t('common_regenTitle')}
                            regenerationDescription={t('common_regenDescription')}
                            regenerationPlaceholder={t('mixStyle_regenPlaceholder')}
                            onClick={!appState.error && appState.generatedImage ? () => openLightbox(lightboxImages.indexOf(appState.generatedImage!)) : undefined}
                            isMobile={isMobile}
                        />
                    </motion.div>
                    
                    {appState.finalPrompt && (
                        <motion.div 
                            className="w-full md:w-96 flex-shrink-0"
                            key="final-prompt-mix" 
                            initial={{ opacity: 0, scale: 0.8 }} 
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ type: 'spring', stiffness: 80, damping: 15, delay: 0.3 }}
                        >
                            <PromptResultCard 
                                title={t('mixStyle_finalPromptTitle')} 
                                promptText={appState.finalPrompt} 
                                className="h-full"
                            />
                        </motion.div>
                    )}

                    {appState.historicalImages.map(sourceUrl => {
                        const videoTask = videoTasks[sourceUrl];
                        if (!videoTask) return null;
                        return (
                            <motion.div
                                className="w-full md:w-auto flex-shrink-0"
                                key={`${sourceUrl}-video`}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                            >
                                <ActionablePolaroidCard
                                    type="output"
                                    caption={t('common_video')}
                                    status={videoTask.status}
                                    mediaUrl={videoTask.resultUrl}
                                    error={videoTask.error}
                                    onClick={videoTask.resultUrl ? () => openLightbox(lightboxImages.indexOf(videoTask.resultUrl!)) : undefined}
                                    isMobile={isMobile}
                                />
                            </motion.div>
                        );
                    })}
                </ResultsView>
            )}

            <Lightbox images={lightboxImages} selectedIndex={lightboxIndex} onClose={closeLightbox} onNavigate={navigateLightbox} />
        </div>
    );
};

export default MixStyle;
