import React, { useEffect, useReducer, useRef, useState } from 'react'
import * as tf from '@tensorflow/tfjs'
import { Button, Card, Upload } from 'antd'
import { SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { RcFile, UploadChangeParam } from 'antd/es/upload'
import { UploadFile } from 'antd/es/upload/interface'

import {
    checkUploadDone,
    getUploadFileArray,
    getUploadFileBase64,
    ILabeledImage,
    ILabeledImageFileJson,
    ILabeledImageSet,
    logger
} from '../../../utils'
import TensorImageThumbWidget from './TensorImageThumbWidget'

const encodeImageTensor = (labeledImgs: ILabeledImageSet[]): any[] => {
    if (!labeledImgs) {
        return []
    }

    labeledImgs.forEach((labeled, index) => {
        labeled.imageList?.forEach((imgItem: ILabeledImage) => {
            if (imgItem.tensor && !imgItem.img) {
                const f32Buf = new Float32Array(imgItem.tensor.dataSync())
                // console.log(f32Buf.length)
                const ui8Buf = new Uint8Array(f32Buf.buffer)
                // console.log(ui8Buf.length)
                imgItem.img = Buffer.from(ui8Buf).toString('base64')
            }
        })
    })
    return labeledImgs
}

const decodeImageTensor = (labeledImgs: ILabeledImageSet[]): any[] => {
    // logger('decodeImageTensor', labeledImgs)
    if (!labeledImgs) {
        return []
    }

    labeledImgs.forEach((labeled, index) => {
        labeled.imageList?.forEach((imgItem: ILabeledImage) => {
            if (imgItem.tensor && imgItem.img) {
                const buf = Buffer.from(imgItem.img, 'base64')
                const ui8Buf = new Uint8Array(buf)
                // console.log(ui8Buf.length)
                const f32Buf = new Float32Array(ui8Buf.buffer)
                // console.log(f32Buf.length)
                imgItem.tensor = tf.tensor3d(f32Buf, imgItem.tensor.shape, imgItem.tensor.dtype)
                delete imgItem.img
            }
            // logger(imgItem)
        })
    })
    return labeledImgs
}

interface IProps {
    model?: tf.LayersModel
    prediction?: tf.Tensor

    labeledImgs?: ILabeledImageSet[]

    onJsonLoad?: (value: ILabeledImageSet[]) => void
}

const LabeledCaptureSetWidget = (props: IProps): JSX.Element => {
    const downloadRef = useRef<HTMLAnchorElement>(null)

    const [sUploadingJson, setUploadingJson] = useState<UploadFile>()
    const [sLabeledImgs, setLabeledImgs] = useState<ILabeledImageSet[]>()

    const [waitingPush, forceWaitingPush] = useReducer((x: number) => x + 1, 0)

    useEffect(() => {
        // logger('LabeledImageSetWidget init ', props.labeledImgs)
        setLabeledImgs(props.labeledImgs)
    }, props.labeledImgs)

    useEffect(() => {
        if (!sUploadingJson) {
            return
        }

        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        const timer = setInterval(async (): Promise<void> => {
            logger('Waiting upload...')
            if (checkUploadDone([sUploadingJson]) > 0) {
                forceWaitingPush()
            } else {
                clearInterval(timer)

                const buffer = await getUploadFileArray(sUploadingJson.originFileObj)
                const fileJson: ILabeledImageFileJson = JSON.parse(buffer.toString())
                const decoded = decodeImageTensor(fileJson.labeledImageSetList)
                setLabeledImgs(decoded)

                // push data to LabeledImageWidget
                const { onJsonLoad } = props
                if (onJsonLoad) {
                    logger('onJsonLoad')
                    onJsonLoad(decoded)
                }
            }
        }, 10)

        return () => {
            clearInterval(timer)
        }
    }, [waitingPush])

    /***********************
     * Event Handler
     ***********************/

    const handleJsonSave = (): void => {
        if (!sLabeledImgs) {
            return
        }

        const fileJson: ILabeledImageFileJson = { labeledImageSetList: encodeImageTensor(sLabeledImgs) }
        const a = downloadRef.current
        if (a) {
            const blob = new Blob(
                [JSON.stringify(fileJson, null, 2)],
                { type: 'application/json' })
            const blobUrl = window.URL.createObjectURL(blob)
            logger(blobUrl)

            // logger(a)
            const filename = 'labeledImages.json'
            a.href = blobUrl
            a.download = filename
            a.click()
            window.URL.revokeObjectURL(blobUrl)
        }
    }

    const handleJsonChange = ({ file }: UploadChangeParam): void => {
        logger('handleFileChange', file.name)

        setUploadingJson(file)
        forceWaitingPush()
    }

    const handleUpload = async (file: RcFile): Promise<string> => {
        // logger(file)
        return getUploadFileBase64(file)
    }

    /***********************
     * Render
     ***********************/

    return (
        <Card title={'Labeled Images'} size='small'>
            <Upload onChange={handleJsonChange} action={handleUpload} showUploadList={false}>
                <Button style={{ width: '300', margin: '0 10%' }}>
                    <UploadOutlined/> Load Train Set
                </Button>
            </Upload>

            <a ref={downloadRef}/>
            <Button style={{ width: '300', margin: '0 10%' }} onClick={handleJsonSave}>
                <SaveOutlined/> Save Train Set
            </Button>

            {sLabeledImgs?.map((labeled, index) => {
                if (!labeled) {
                    return ''
                }

                const title = `${labeled.label}(${labeled.imageList?.length.toString()})`
                return <Card key={index} title={title} size='small'>
                    {
                        labeled.imageList?.map((imgItem: ILabeledImage) => {
                            if (imgItem.tensor) {
                                return <TensorImageThumbWidget key={imgItem.uid} data={imgItem.tensor}/>
                            } else if (imgItem.img) {
                                return <img key={imgItem.uid} src={imgItem.img} alt={imgItem.name}
                                    height={100} style={{ margin: 4 }}/>
                            } else {
                                return <></>
                            }
                        })
                    }
                </Card>
            })}
        </Card>
    )
}

export default LabeledCaptureSetWidget
