/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useCallback, ChangeEvent, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateDressedModelImage, editImageWithPrompt } from '../services/geminiService';
import ActionablePolaroidCard from './ActionablePolaroidCard';
import Lightbox from './Lightbox';
import { 
    AppScreenHeader,
    handleFileUpload,
    useMediaQuery,
    ImageForZip,
    ResultsView,
    type DressTheModelState,
    useLightbox,
    OptionsPanel,
    Slider,
    useVideoGeneration,
    processAndDownloadAll,
    SearchableSelect,
    useAppControls,
    embedJsonInPng,
} from './uiUtils';
import { CheckIcon, CloseIcon, InfoIcon } from './icons';

interface DressTheModelProps {
    mainTitle: string;
    subtitle: string;
    useSmartTitleWrapping: boolean;
    smartTitleWrapWords: number;
    uploaderCaptionModel: string;
    uploaderDescriptionModel: string;
    uploaderCaptionClothing: string;
    uploaderDescriptionClothing: string;
    addImagesToGallery: (images: string[]) => void;
    appState: DressTheModelState;
    onStateChange: (newState: DressTheModelState) => void;
    onReset: () => void;
    onGoBack: () => void;
    logGeneration: (appId: string, preGenState: any, thumbnailUrl: string) => void;
}


const QualityGuideModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void; }) => (
    <AnimatePresence>
        {isOpen && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="modal-overlay z-[60]"
                aria-modal="true"
                role="dialog"
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    onClick={(e) => e.stopPropagation()}
                    className="modal-content !max-w-2xl !bg-neutral-900/80"
                >
                    <div className="relative">
                        <button onClick={onClose} className="absolute -top-2 -right-2 p-1.5 rounded-full hover:bg-white/10 transition-colors" aria-label="Đóng">
                            <CloseIcon className="h-5 w-5" />
                        </button>
                        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-4">
                            <h3 className="base-font font-bold text-xl text-yellow-400 border-b border-yellow-400/20 pb-2">Hướng dẫn Nâng cao Chất lượng Ảnh</h3>
                            
                            <p className="text-sm text-neutral-300">
                                <strong>Nguyên tắc vàng khi làm việc với AI tạo sinh là:</strong> Mô tả kết quả cuối cùng bạn muốn thấy, thay vì ra lệnh cho nó thực hiện các bước kỹ thuật.
                            </p>
                            <p className="text-sm text-neutral-300">
                                Để có được một bức ảnh sắc nét và chất lượng cao, bạn không yêu cầu AI "làm nét", mà hãy mô tả một bức ảnh mà vốn dĩ nó đã sắc nét. Dưới đây là các kỹ thuật và từ khóa hiệu quả nhất bạn có thể bổ sung vào phần "Ghi chú bổ sung".
                            </p>
                        
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                <h4 className="font-bold text-neutral-200">1. Sử dụng Thuật ngữ Nhiếp ảnh Chuyên nghiệp</h4>
                                <p className="text-xs text-neutral-400">Đây là cách hiệu quả nhất. AI được huấn luyện trên hàng triệu bức ảnh chuyên nghiệp và hiểu rất rõ các thuật ngữ này.</p>
                                <ul className="list-disc list-inside text-sm text-neutral-300 space-y-1 pl-2 text-xs">
                                    <li><strong>professional photography:</strong> Ảnh chụp chuyên nghiệp.</li>
                                    <li><strong>DSLR photo:</strong> Ảnh chụp từ máy ảnh kỹ thuật số chuyên nghiệp.</li>
                                    <li><strong>shot on 70mm film:</strong> Chụp bằng phim 70mm (cho độ chi tiết và chất ảnh điện ảnh).</li>
                                    <li><strong>sharp focus:</strong> Lấy nét sắc cạnh, làm nổi bật chủ thể.</li>
                                    <li><strong>8K, ultra-high resolution, UHD:</strong> Yêu cầu độ phân giải siêu cao.</li>
                                    <li><strong>insanely detailed, hyperdetailed:</strong> Cực kỳ chi tiết.</li>
                                </ul>
                            </div>
                            
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                <h4 className="font-bold text-neutral-200">2. Mô tả Chất liệu và Chi tiết</h4>
                                <p className="text-xs text-neutral-400">Thay vì nói "làm nét", hãy mô tả các chi tiết mà bạn muốn thấy rõ nét.</p>
                                <ul className="list-disc list-inside text-sm text-neutral-300 space-y-1 pl-2 text-xs">
                                    <li><strong>Quần áo:</strong> "váy lụa với kết cấu vải chi tiết", "áo len với từng sợi len rõ ràng", "họa tiết thêu tinh xảo".</li>
                                    <li><strong>Chân dung:</strong> "khuôn mặt với chi tiết lỗ chân lông rõ nét", "nếp nhăn tự nhiên quanh mắt", "sợi tóc bay trong gió".</li>
                                    <li><strong>Vật thể:</strong> "bề mặt kim loại xước", "vân gỗ tự nhiên".</li>
                                </ul>
                            </div>
                            
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                <h4 className="font-bold text-neutral-200">3. Mô tả Ánh sáng</h4>
                                <p className="text-xs text-neutral-400">Ánh sáng tốt là yếu tố quyết định độ sắc nét và chất lượng của một bức ảnh.</p>
                                <ul className="list-disc list-inside text-sm text-neutral-300 space-y-1 pl-2 text-xs">
                                    <li><strong>cinematic lighting:</strong> Ánh sáng điện ảnh (thường có độ tương phản và chiều sâu).</li>
                                    <li><strong>dramatic lighting:</strong> Ánh sáng kịch tính, tạo bóng đổ mạnh.</li>
                                    <li><strong>soft light:</strong> Ánh sáng dịu, thường thấy trong studio, làm nổi bật chi tiết một cách nhẹ nhàng.</li>
                                </ul>
                            </div>
                            
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                <h4 className="font-bold text-neutral-200">Ví dụ thực tế</h4>
                                <div className="bg-neutral-800/50 p-3 rounded-md text-xs space-y-2">
                                    <p><strong>Prompt TRƯỚC:</strong> "một người phụ nữ mặc chiếc váy đỏ"</p>
                                    <p><strong>Prompt SAU (bổ sung vào Ghi chú):</strong><br/> "Tạo ra một bức ảnh chụp chuyên nghiệp, <strong>sharp focus, insanely detailed</strong>. Người phụ nữ mặc chiếc váy lụa đỏ với <strong>kết cấu vải tinh xảo</strong>. Sử dụng <strong>cinematic lighting</strong> để tạo chiều sâu và làm nổi bật các nếp gấp trên váy. <strong>8K resolution</strong>."</p>
                                </div>
                            </div>
                        
                            <div className="space-y-2 pt-2 border-t border-white/10">
                                <h4 className="font-bold text-neutral-200">Áp dụng vào ứng dụng</h4>
                                <p className="text-xs text-neutral-400">Tận dụng ô "Ghi chú bổ sung" ở phần tùy chỉnh. Chọn các tùy chọn cơ bản, sau đó thêm các từ khóa nâng cao chất lượng vào ghi chú.</p>
                                <div className="bg-neutral-800/50 p-3 rounded-md text-xs space-y-2">
                                    <p><strong>Ví dụ:</strong></p>
                                    <p><strong>Bối cảnh:</strong> <span>Đường phố Paris</span></p>
                                    <p><strong>Phong cách ảnh:</strong> <span>Ảnh chụp tự nhiên (Candid)</span></p>
                                    <p><strong>Ghi chú bổ sung:</strong><br/><span>professional DSLR photo, sharp focus, 8K, cinematic lighting. Giữ lại chi tiết kết cấu của vải trên trang phục.</span></p>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        )}
    </AnimatePresence>
);


const DressTheModel: React.FC<DressTheModelProps> = (props) => {
    const { 
        uploaderCaptionModel, uploaderDescriptionModel,
        uploaderCaptionClothing, uploaderDescriptionClothing,
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
    const [isGuideModalOpen, setGuideModalOpen] = useState(false);


    useEffect(() => {
        setLocalNotes(appState.options.notes);
    }, [appState.options.notes]);
    
    const BACKGROUND_OPTIONS = t('dressTheModel_backgroundOptions');
    const POSE_OPTIONS = t('dressTheModel_poseOptions');
    const PHOTO_STYLE_OPTIONS = t('dressTheModel_photoStyleOptions');
    const ASPECT_RATIO_OPTIONS = t('aspectRatioOptions');

    const lightboxImages = [appState.modelImage, appState.clothingImage, ...appState.historicalImages].filter((img): img is string => !!img);

    const handleModelImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        handleFileUpload(e, (imageDataUrl) => {
            onStateChange({
                ...appState,
                stage: appState.clothingImage ? 'configuring' : 'idle',
                modelImage: imageDataUrl,
                generatedImages: [],
                historicalImages: [],
                error: null,
            });
            addImagesToGallery([imageDataUrl]);
        });
    };

    const handleClothingImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        handleFileUpload(e, (imageDataUrl) => {
            onStateChange({
                ...appState,
                stage: appState.modelImage ? 'configuring' : 'idle',
                clothingImage: imageDataUrl,
                generatedImages: [],
                historicalImages: [],
                error: null,
            });
            addImagesToGallery([imageDataUrl]);
        });
    };
    
    const handleModelImageChange = (newUrl: string) => {
        onStateChange({
            ...appState,
            stage: appState.clothingImage ? 'configuring' : 'idle',
            modelImage: newUrl,
        });
        addImagesToGallery([newUrl]);
    };
    const handleClothingImageChange = (newUrl: string) => {
        onStateChange({
            ...appState,
            stage: appState.modelImage ? 'configuring' : 'idle',
            clothingImage: newUrl,
        });
        addImagesToGallery([newUrl]);
    };
    const handleGeneratedImageChange = (index: number) => (newUrl: string) => {
        const newGenerated = [...appState.generatedImages];
        newGenerated[index] = { ...newGenerated[index], url: newUrl, status: 'done' };
        const newHistorical = [...appState.historicalImages, newUrl];
        onStateChange({ ...appState, stage: 'results', generatedImages: newGenerated, historicalImages: newHistorical });
        addImagesToGallery([newUrl]);
    };

    const handleOptionChange = (field: keyof DressTheModelState['options'], value: string | boolean | (string | null)[]) => {
        onStateChange({ ...appState, options: { ...appState.options, [field]: value } });
    };

    const handleRefImageChange = (index: number) => (newUrl: string) => {
        const newRefs = [...appState.options.naturalEnhancementRefs];
        newRefs[index] = newUrl;
        handleOptionChange('naturalEnhancementRefs', newRefs);
    };
    
    const handleReferenceImageChange = (url: string | null) => {
        onStateChange({ ...appState, referenceImage: url });
    };

    const executeSingleGeneration = async () => {
        if (!appState.modelImage || !appState.clothingImage) return;
        const preGenState = { ...appState };
        
        const singlePrompt = { caption: t('common_result'), pose: 'Tự động' };

        onStateChange({
            ...appState,
            stage: 'generating',
            error: null,
            generatedImages: [{ caption: singlePrompt.caption, status: 'pending' }],
        });

        try {
            const resultUrl = await generateDressedModelImage(
                appState.modelImage!, 
                appState.clothingImage!, 
                { ...appState.options, pose: singlePrompt.pose },
                appState.referenceImage
            );
            const settingsToEmbed = {
                viewId: 'dress-the-model',
                state: { ...preGenState, stage: 'configuring', generatedImages: [], historicalImages: [], error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            
            logGeneration('dress-the-model', preGenState, urlWithMetadata);
            addImagesToGallery([urlWithMetadata]);

            onStateChange({
                ...appState,
                stage: 'results',
                generatedImages: [{ caption: singlePrompt.caption, url: urlWithMetadata, status: 'done' }],
                historicalImages: [...appState.historicalImages, urlWithMetadata],
            });

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            onStateChange({
                ...appState,
                stage: 'results',
                error: null,
                generatedImages: [{ caption: singlePrompt.caption, error: errorMessage, status: 'error' }],
            });
        }
    };

    const executeMultiAngleGeneration = async () => {
        if (!appState.modelImage || !appState.clothingImage) return;
        const preGenState = { ...appState };
        
        const consistencyInstruction = "YÊU CẦU CỰC KỲ QUAN TRỌNG KHI TẠO NHIỀU GÓC: Đây là một phần của một bộ ảnh. Tất cả các ảnh trong bộ này PHẢI có cùng một người mẫu (giữ nguyên 100% khuôn mặt và kiểu tóc), cùng một bối cảnh, và cùng một kiểu ánh sáng. Chỉ thay đổi tư thế theo yêu cầu.";
        const combinedNotes = [appState.options.notes, consistencyInstruction].filter(Boolean).join('\n');

        const anglePrompts = [
            { caption: 'Chụp chính diện', pose: 'Đứng thẳng, chụp chính diện' },
            { caption: 'Chụp góc nghiêng 3/4', pose: 'Tư thế đứng, chụp góc nghiêng 3/4' },
            { caption: 'Nhìn qua vai', pose: 'Tư thế đang di chuyển, nhìn qua vai' },
            { caption: 'Chụp từ phía sau', pose: 'Chụp từ phía sau lưng' },
        ];

        onStateChange({
            ...appState,
            stage: 'generating',
            error: null,
            generatedImages: anglePrompts.map(p => ({ caption: p.caption, status: 'pending' })),
        });

        const generationPromises = anglePrompts.map(async ({ caption, pose }) => {
            try {
                const resultUrl = await generateDressedModelImage(
                    appState.modelImage!, 
                    appState.clothingImage!, 
                    { 
                        ...appState.options, 
                        pose,
                        notes: combinedNotes, // Override notes with consistency instruction
                    },
                    appState.referenceImage
                );
                const settingsToEmbed = {
                    viewId: 'dress-the-model',
                    state: { ...preGenState, stage: 'configuring', generatedImages: [], historicalImages: [], error: null },
                };
                const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
                return { caption, url: urlWithMetadata, status: 'done' as 'done' };
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                return { caption, error: errorMessage, status: 'error' as 'error' };
            }
        });
        
        const results = await Promise.all(generationPromises);
        
        const successfulResults = results.filter(r => r.status === 'done' && r.url);
        if (successfulResults.length > 0) {
            logGeneration('dress-the-model', preGenState, successfulResults[0].url!);
            addImagesToGallery(successfulResults.map(r => r.url!));
        }

        onStateChange({
            ...appState,
            stage: 'results',
            generatedImages: results,
            historicalImages: [...appState.historicalImages, ...successfulResults.map(r => r.url!)],
        });
    };
    
    const handleRegeneration = async (index: number, prompt: string, aspectRatio: string) => {
        const imageToRegen = appState.generatedImages[index];
        if (!imageToRegen || !imageToRegen.url) return;

        const preGenState = { ...appState };
        const newGenerated = [...appState.generatedImages];
        newGenerated[index] = { ...newGenerated[index], status: 'pending' };
        onStateChange({ ...appState, stage: 'generating', generatedImages: newGenerated });

        try {
            const resultUrl = await editImageWithPrompt(imageToRegen.url, prompt, aspectRatio, appState.options.removeWatermark);
            const settingsToEmbed = {
                viewId: 'dress-the-model',
                state: { ...appState, stage: 'configuring', generatedImages: [], historicalImages: [], error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            logGeneration('dress-the-model', preGenState, urlWithMetadata);

            const finalGenerated = [...appState.generatedImages];
            finalGenerated[index] = { ...finalGenerated[index], status: 'done', url: urlWithMetadata };
            
            onStateChange({
                ...appState,
                stage: 'results',
                generatedImages: finalGenerated,
                historicalImages: [...appState.historicalImages, urlWithMetadata]
            });
            addImagesToGallery([urlWithMetadata]);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            const finalGenerated = [...appState.generatedImages];
            finalGenerated[index] = { ...finalGenerated[index], status: 'error', error: errorMessage };
            onStateChange({ ...appState, stage: 'results', generatedImages: finalGenerated });
        }
    };
    
    const handleBackToOptions = () => {
        onStateChange({ ...appState, stage: 'configuring', error: null });
    };

    const handleDownloadAll = () => {
        const inputImages: ImageForZip[] = [];
        if (appState.modelImage) {
            inputImages.push({ url: appState.modelImage, filename: 'model-goc', folder: 'input' });
        }
        if (appState.clothingImage) {
            inputImages.push({ url: appState.clothingImage, filename: 'trang-phuc-goc', folder: 'input' });
        }
        
        processAndDownloadAll({
            inputImages,
            historicalImages: appState.historicalImages,
            videoTasks,
            zipFilename: 'ket-qua-thu-do.zip',
            baseOutputFilename: 'ket-qua-thu-do',
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
                        <Uploader id="model-upload" onUpload={handleModelImageUpload} onImageChange={handleModelImageChange} caption={uploaderCaptionModel} description={uploaderDescriptionModel} currentImage={appState.modelImage} placeholderType="person" cardType="photo-input" />
                        <Uploader id="clothing-upload" onUpload={handleClothingImageUpload} onImageChange={handleClothingImageChange} caption={uploaderCaptionClothing} description={uploaderDescriptionClothing} currentImage={appState.clothingImage} placeholderType="clothing" cardType="clothing-input" />
                    </motion.div>
                </div>
            )}

            {appState.stage === 'configuring' && appState.modelImage && appState.clothingImage && (
                <motion.div 
                    className="flex flex-col items-center gap-8 w-full max-w-screen-xl mx-auto py-6" 
                    initial={{ opacity: 0, y: 20 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ duration: 0.5 }}
                >
                    <div className="w-full overflow-x-auto pb-4">
                        <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8 w-full md:w-max mx-auto px-4">
                            <ActionablePolaroidCard type="photo-input" mediaUrl={appState.modelImage} caption={t('dressTheModel_modelCaption')} status="done" onClick={() => appState.modelImage && openLightbox(lightboxImages.indexOf(appState.modelImage))} onImageChange={handleModelImageChange} />
                            <ActionablePolaroidCard type="clothing-input" mediaUrl={appState.clothingImage} caption={t('dressTheModel_clothingCaption')} status="done" onClick={() => appState.clothingImage && openLightbox(lightboxImages.indexOf(appState.clothingImage))} onImageChange={handleClothingImageChange} />
                        </div>
                    </div>

                    <div className="w-full flex flex-col lg:flex-row items-start justify-center gap-8 px-4">
                        <OptionsPanel className="flex-1">
                            <h2 className="base-font font-bold text-2xl text-yellow-400 border-b border-yellow-400/20 pb-2">{t('common_options')}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <SearchableSelect id="background" label={t('dressTheModel_backgroundLabel')} options={BACKGROUND_OPTIONS} value={appState.options.background} onChange={(value) => handleOptionChange('background', value)} placeholder={t('dressTheModel_backgroundPlaceholder')} />
                                <SearchableSelect id="style" label={t('dressTheModel_styleLabel')} options={PHOTO_STYLE_OPTIONS} value={appState.options.style} onChange={(value) => handleOptionChange('style', value)} placeholder={t('dressTheModel_stylePlaceholder')} />
                                <div>
                                    <label htmlFor="aspect-ratio-dress" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('common_aspectRatio')}</label>
                                    <select id="aspect-ratio-dress" value={appState.options.aspectRatio} onChange={(e) => handleOptionChange('aspectRatio', e.target.value)} className="form-input">
                                        {ASPECT_RATIO_OPTIONS.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label htmlFor="notes" className="block text-left base-font font-bold text-lg text-neutral-200">{t('common_additionalNotes')}</label>
                                    <button
                                        onClick={() => setGuideModalOpen(true)}
                                        className="flex items-center gap-1.5 text-sm text-yellow-300 hover:text-yellow-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded-sm"
                                        aria-label="Xem hướng dẫn nâng cao chất lượng ảnh"
                                    >
                                        <InfoIcon className="h-4 w-4" />
                                        Xem hướng dẫn
                                    </button>
                                </div>
                                <textarea id="notes" value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} onBlur={() => { if (localNotes !== appState.options.notes) { handleOptionChange('notes', localNotes); } }} placeholder={t('dressTheModel_notesPlaceholder')} className="form-input h-24" rows={3} />
                            </div>
                            
                             <div className="pt-4 border-t border-white/10">
                                <label className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('dressTheModel_naturalEnhancement_title')}</label>
                                <div className="flex items-center gap-4">
                                    {['off', 'automatic', 'custom'].map(mode => (
                                        <div key={mode} className="flex items-center">
                                            <input
                                                type="radio"
                                                id={`natural-enhancement-${mode}`}
                                                name="natural-enhancement-mode"
                                                value={mode}
                                                checked={appState.options.naturalEnhancementMode === mode}
                                                onChange={() => handleOptionChange('naturalEnhancementMode', mode)}
                                                className="h-4 w-4 border-neutral-500 bg-neutral-700 text-yellow-400 focus:ring-yellow-400"
                                            />
                                            <label htmlFor={`natural-enhancement-${mode}`} className="ml-2 block text-sm font-medium text-neutral-300 capitalize">
                                                {t(`dressTheModel_naturalEnhancement_${mode}`)}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                                <AnimatePresence>
                                {appState.options.naturalEnhancementMode === 'custom' && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                        animate={{ opacity: 1, height: 'auto', marginTop: '1rem' }}
                                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <p className="text-sm text-neutral-400 mb-3">{t('dressTheModel_naturalEnhancement_refDescription')}</p>
                                        <div className="grid grid-cols-4 gap-2 deco-uploader-container">
                                            {appState.options.naturalEnhancementRefs.map((refUrl, index) => (
                                                <div key={index} className="w-full">
                                                    <ActionablePolaroidCard
                                                        type="uploader"
                                                        caption={t('dressTheModel_naturalEnhancement_refCaption', index + 1)}
                                                        status="done"
                                                        mediaUrl={refUrl || undefined}
                                                        placeholderType="person"
                                                        onImageChange={handleRefImageChange(index)}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                                </AnimatePresence>
                            </div>

                            {appState.historicalImages.length > 0 && (
                                <div className="pt-4 border-t border-white/10">
                                    <h3 className="base-font font-bold text-xl text-yellow-400 mb-2">Tham chiếu Phong cách (Tùy chọn)</h3>
                                    <p className="text-sm text-neutral-400 mb-3">Chọn một ảnh đã tạo trước đó để AI sao chép phong cách (ánh sáng, màu sắc).</p>
                                    <div className="flex flex-wrap gap-2 items-center">
                                        {appState.historicalImages.map(imgUrl => (
                                            <div key={imgUrl} className="relative cursor-pointer group" onClick={() => handleReferenceImageChange(imgUrl)}>
                                                <img src={imgUrl} alt="Ảnh tham chiếu lịch sử" className={`w-20 h-20 object-cover rounded-md transition-all ${appState.referenceImage === imgUrl ? 'ring-4 ring-yellow-400' : 'ring-2 ring-transparent group-hover:ring-yellow-400/50'}`}/>
                                                {appState.referenceImage === imgUrl && (
                                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md pointer-events-none">
                                                        <CheckIcon className="h-8 w-8 text-yellow-400" />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {appState.referenceImage && <button onClick={() => handleReferenceImageChange(null)} className="p-1.5 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors self-center" aria-label="Bỏ chọn ảnh tham chiếu"><CloseIcon className="h-4 w-4" /></button>}
                                    </div>
                                </div>
                            )}
                            
                            <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-white/10">
                                <div className="flex items-center">
                                    <input type="checkbox" id="remove-watermark-dress" checked={appState.options.removeWatermark} onChange={(e) => handleOptionChange('removeWatermark', e.target.checked)} className="h-4 w-4 rounded border-neutral-500 bg-neutral-700 text-yellow-400 focus:ring-yellow-400 focus:ring-offset-neutral-800" aria-label={t('common_removeWatermark')} />
                                    <label htmlFor="remove-watermark-dress" className="ml-3 block text-sm font-medium text-neutral-300">{t('common_removeWatermark')}</label>
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-4 pt-4">
                                <button onClick={onReset} className="btn btn-secondary">{t('common_changeImage')}</button>
                                <button onClick={executeSingleGeneration} className="btn btn-secondary" disabled={isLoading}>{isLoading ? t('dressTheModel_creating') : t('dressTheModel_createButton')}</button>
                                <button onClick={executeMultiAngleGeneration} className="btn btn-primary" disabled={isLoading}>{isLoading ? t('dressTheModel_creating') : 'Tạo ảnh nhiều góc'}</button>
                            </div>
                        </OptionsPanel>
                    </div>
                </motion.div>
            )}
            
            {(appState.stage === 'generating' || appState.stage === 'results') && (
                <ResultsView stage={appState.stage} originalImage={appState.modelImage} onOriginalClick={() => appState.modelImage && openLightbox(lightboxImages.indexOf(appState.modelImage))} error={appState.error} isMobile={isMobile} actions={
                    <>
                        {appState.generatedImages.some(img => img.status === 'done') && !appState.error && (<button onClick={handleDownloadAll} className="btn btn-secondary">{t('common_downloadAll')}</button>)}
                        <button onClick={handleBackToOptions} className="btn btn-secondary">{t('common_editOptions')}</button>
                        <button onClick={onReset} className="btn btn-secondary">{t('common_startOver')}</button>
                    </>
                }>
                    {appState.clothingImage && (
                        <motion.div key="clothing" className="w-full md:w-auto flex-shrink-0" whileHover={{ scale: 1.05, zIndex: 10 }} transition={{ duration: 0.2 }}>
                            <ActionablePolaroidCard type="clothing-input" caption={t('dressTheModel_clothingCaption')} status="done" mediaUrl={appState.clothingImage} isMobile={isMobile} onClick={() => appState.clothingImage && openLightbox(lightboxImages.indexOf(appState.clothingImage))} onImageChange={handleClothingImageChange} />
                        </motion.div>
                    )}
                    {appState.generatedImages.map((image, index) => (
                        <motion.div className="w-full md:w-auto flex-shrink-0" key={image.caption + index} initial={{ opacity: 0, scale: 0.5, y: 100 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 80, damping: 15, delay: 0.2 + index * 0.1 }}>
                            <ActionablePolaroidCard
                                type="output"
                                caption={image.caption}
                                status={image.status}
                                mediaUrl={image.url}
                                error={image.error}
                                onImageChange={handleGeneratedImageChange(index)}
                                onRegenerate={(prompt, aspectRatio) => handleRegeneration(index, prompt, aspectRatio)}
                                onGenerateVideoFromPrompt={(prompt) => image.url && generateVideo(image.url, prompt)}
                                regenerationTitle={t('common_regenTitle')}
                                regenerationDescription={t('common_regenDescription')}
                                regenerationPlaceholder={t('dressTheModel_regenPlaceholder')}
                                onClick={image.status === 'done' && image.url ? () => openLightbox(lightboxImages.indexOf(image.url!)) : undefined}
                                isMobile={isMobile}
                            />
                        </motion.div>
                    ))}
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
            <QualityGuideModal isOpen={isGuideModalOpen} onClose={() => setGuideModalOpen(false)} />
        </div>
    );
};

export default DressTheModel;