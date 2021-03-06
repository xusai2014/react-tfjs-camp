import React, { useEffect, useRef, useState } from 'react'
import * as tf from '@tensorflow/tfjs'
import * as knnClassifier from '@tensorflow-models/knn-classifier'
import {Button, Card, Col, Divider, message, Row, Select, Tabs} from 'antd'

import {
    arrayDispose,
    getImageDataFromBase64,
    IKnnPredictResult,
    ILabeledImageFileJson,
    ILabeledImageSet,
    logger,
    STATUS
} from '../../utils'
import { MOBILENET_IMAGE_SIZE, MOBILENET_MODEL_PATH } from '../../constant'
import ImageUploadWidget from '../common/tensor/ImageUploadWidget'
import LabeledImageInputSet from '../common/tensor/LabeledImageInputSet'
import LabeledImageSetWidget from '../common/tensor/LabeledImageSetWidget'
import AIProcessTabs, { AIProcessTabPanes } from '../common/AIProcessTabs'
import MarkdownWidget from '../common/MarkdownWidget'
import TfvisModelWidget from '../common/tfvis/TfvisModelWidget'
import TfvisLayerWidget from '../common/tfvis/TfvisLayerWidget'
import WebCamera, { IWebCameraHandler } from '../common/tensor/WebCamera'

const { TabPane } = Tabs

const KNN_TOPK = 10

const MobilenetClassifier = (): JSX.Element => {
    /***********************
     * useState
     ***********************/

    const [sTabCurrent, setTabCurrent] = useState<number>(1)

    const [sTfBackend, setTfBackend] = useState<string>()
    const [sStatus, setStatus] = useState<STATUS>(STATUS.INIT)

    const [sKnn, setKnn] = useState<knnClassifier.KNNClassifier>()
    const [sModel, setModel] = useState<tf.LayersModel>()

    const [sLabeledImgs, setLabeledImgs] = useState<ILabeledImageSet[]>()
    const [sPredictResult, setPredictResult] = useState<tf.Tensor | IKnnPredictResult >()

    const webcamRef = useRef<IWebCameraHandler>(null)

    /***********************
     * useEffect
     ***********************/

    useEffect(() => {
        logger('init model ...')

        tf.backend()
        setTfBackend(tf.getBackend())

        setStatus(STATUS.LOADING)

        const _knn = knnClassifier.create()
        setKnn(_knn)

        let _model: tf.LayersModel
        tf.loadLayersModel(MOBILENET_MODEL_PATH).then(
            (mobilenet) => {
                // Return a model that outputs an internal activation.
                const layer = mobilenet.getLayer('conv_preds')
                _model = tf.model({ inputs: mobilenet.inputs, outputs: layer.output })

                // Warmup the model. This isn't necessary, but makes the first prediction
                // faster. Call `dispose` to release the WebGL memory allocated for the return
                // value of `predict`.
                const _temp = _model.predict(tf.zeros([1, MOBILENET_IMAGE_SIZE, MOBILENET_IMAGE_SIZE, 3])) as tf.Tensor
                _temp.dispose()

                setModel(_model)
                setStatus(STATUS.LOADED)
            },
            (error) => {
                logger(error)
            }
        )

        return () => {
            logger('Model Dispose')
            _model?.dispose()
            _knn.dispose()
        }
    }, [])

    /***********************
     * Functions
     ***********************/

    const formatImageForMobilenet = (imgTensor: tf.Tensor, imageSize: number): tf.Tensor => {
        const sample = tf.image.resizeBilinear(imgTensor as tf.Tensor3D, [imageSize, imageSize])
        // logger(JSON.stringify(sample))

        const offset = tf.scalar(127.5)
        // Normalize the image from [0, 255] to [-1, 1].
        const normalized = sample.sub(offset).div(offset)
        // Reshape to a single-element batch so we can pass it to predict.
        return normalized.reshape([1, imageSize, imageSize, 3])
    }

    const train = async (imageSetList: ILabeledImageSet[]): Promise<void> => {
        logger('train', imageSetList)

        for (const imgSet of imageSetList) {
            const { label, imageList } = imgSet
            if (imageList) {
                for (const imgItem of imageList) {
                    const imgBase64 = imgItem.img
                    if (imgBase64) {
                        const _imgData = await getImageDataFromBase64(imgBase64)
                        const _imgTensor = tf.browser.fromPixels(_imgData, 3)
                        const _imgBatched = formatImageForMobilenet(_imgTensor, MOBILENET_IMAGE_SIZE)
                        const _imgFeature = sModel?.predict(_imgBatched) as tf.Tensor

                            // logger('sKnn.addExample', label, _imgFeature)
                            sKnn?.addExample(_imgFeature, label)
                    }
                }
            }
        }
    }

    const resetKnn = (): void => {
        sKnn?.clearAllClasses()
    }

    const handleTrain = (): void => {
        if (sLabeledImgs) {
            setStatus(STATUS.TRAINING)
            train(sLabeledImgs).then(
                () => {
                    setStatus(STATUS.TRAINED)
                },
                (error) => {
                    logger(error)
                })
        }
    }

    const handleKnnReset = (): void => {
        resetKnn()
    }

    const handlePredict = async (imgTensor: tf.Tensor): Promise<void> => {
        if (!imgTensor) {
            return
        }
        const [imgFeature] = tf.tidy(() => {
            const batched = formatImageForMobilenet(imgTensor, MOBILENET_IMAGE_SIZE)
            const imgFeature = sModel?.predict(batched) as tf.Tensor
            // logger(imgFeature)
            return [imgFeature]
        })
        try {
            const res = await sKnn?.predictClass(imgFeature, KNN_TOPK)
            // logger('handlePredict', res)
            setPredictResult(res)
        } catch (e) {
            // logger(e)
            await message.error(e.message)
        }
    }

    const handleLabeledImagesSubmit = (value: ILabeledImageFileJson): void => {
        logger('handleLabeledImagesSubmit', value)

        const labeledImageSetList = value.labeledImageSetList
        setLabeledImgs(labeledImageSetList)
    }

    const handleLoadJson = (values: ILabeledImageSet[]): void => {
        sLabeledImgs && arrayDispose(sLabeledImgs)
        setLabeledImgs(values)
    }

    const handleTabChange = (current: number): void => {
        setTabCurrent(current)
    }

    /***********************
     * Render
     ***********************/

    const knnInfo = (): JSX.Element => {
        const knnNumClasses = sKnn?.getNumClasses() ?? 0
        const examples = sKnn?.getClassExampleCount()
        return <div>
            <p>KNN have {knnNumClasses} classes</p>
            <p>{JSON.stringify(examples)}</p>
        </div>
    }

    return (
        <AIProcessTabs title={'Mobilenet + KNN'} current={sTabCurrent} onChange={handleTabChange}>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.INFO}>
                <MarkdownWidget url={'/docs/mobilenet.md'}/>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.DATA}>
                <Row>
                    <Col span={12}>
                        <Card title='Images Label Panel' style={{ margin: '8px' }} size='small'>
                            <LabeledImageInputSet model={sModel} onSave={handleLabeledImagesSubmit} />
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title='Mobilenet + KNN Train Set' style={{ margin: '8px' }} size='small'>
                            <LabeledImageSetWidget model={sModel} labeledImgs={sLabeledImgs} onJsonLoad={handleLoadJson}/>
                        </Card>
                    </Col>
                </Row>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.MODEL}>
                <Row>
                    <Col span={24}>
                        <Card title='Mobilenet' style={{ margin: '8px' }} size='small'>
                            预训练模型
                        </Card>
                    </Col>
                    <Divider orientation={'center'}>Mobilenet 的输出作为 KNN 的样本输入</Divider>
                    <Col span={12}>
                        <Card title='KNN 样本库' style={{ margin: '8px' }} size='small'>
                            KNN 样本库
                        </Card>
                    </Col>
                </Row>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.TRAIN}>
                <Row>
                    <Col span={12}>
                        <Card title='Mobilenet + KNN Train Set' style={{ margin: '8px' }} size='small'>
                            <LabeledImageSetWidget model={sModel} labeledImgs={sLabeledImgs} onJsonLoad={handleLoadJson}/>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title='Mobilenet + KNN Train Set' style={{ margin: '8px' }} size='small'>
                            <div>
                                <Button onClick={handleTrain} type='primary' style={{ width: '30%', margin: '0 10%' }}> Train </Button>
                                <Button onClick={handleKnnReset} style={{ width: '30%', margin: '0 10%' }}> Reset Model </Button>
                                <div>status: {sStatus}</div>
                                {knnInfo()}
                            </div>
                            <p>backend: {sTfBackend}</p>
                        </Card>
                    </Col>
                </Row>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.PREDICT}>
                <Row>
                    <Col span={12}>
                        <Card title='Prediction' style={{ margin: '8px' }} size='small'>
                            <ImageUploadWidget model={sModel} onSubmit={handlePredict} prediction={sPredictResult}/>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title='Prediction' size='small'>
                            <WebCamera ref={webcamRef} model={sModel} onSubmit={handlePredict} prediction={sPredictResult}
                                isPreview />
                        </Card>
                    </Col>
                </Row>
            </TabPane>
        </AIProcessTabs>
    )
}

export default MobilenetClassifier
