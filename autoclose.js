const { use, expect } = require("chai")
const { solidity } = require("ethereum-waffle");
const { MarketCls } = require("../marketCls")
use(solidity)

describe("自动平仓", function () {
    let marketCls
    beforeEach(async () => {
        marketCls = new MarketCls({ isLong: true })
        await marketCls.initialize()
        await marketCls.initAutoOpen()
        await marketCls.initAutoClose()
    })

    it("自动平仓触发并检查资金变化", async function () {

        // 设置市场价格为 40000
        await marketCls.setPrice(40000)
        // 增加市场单：买入 9000 手，价格为 40000，支付 1000
        await marketCls.increaseMarket({
            price: 40000,
            pay: 1000,
            size: 9000
        })
        // 增加限价单：卖出 9000 手，价格为 40000 + 500，支付 1000
        await marketCls.decreaseLimit({
            price: 40000 + 500,
            pay: 1000,
            size: 9000
        })
        // 设置市场价格为 40000 + 501，此时上述卖单被自动平仓触发
        await marketCls.setPrice(40000 + 501)
        // 检查平仓后是否只有一张已关闭的订单
        await marketCls.checkOrdersToExecute({ num: 1, isOpen: false })
        // 执行自动平仓函数
        await marketCls.runAutoClose()
        // 检查订单数量是否为 0
        await marketCls.validSize(0)
        // 计算资金变化，预期平仓盈亏为 9000 * 501.0 / 40000 = 112.5
        const pnl = 9000 * 501.0 / 40000
        // 检查交易所资金转出是否正确
        await marketCls.validVaultTransferOut(pnl) // 112.5
        // 检查交易所手续费收入是否正确，手续费为 9 + 1 = 10
        const fees = 9 + 1
        await marketCls.validFeeVaultReceive(fees) // 10
        // 检查用户账户资金变化是否正确，预期变化为 1000 + pnl - 9 - fees
        await marketCls.validBalanceChange(1000 + pnl - 9 - fees)
        // 检查事件中的价格
        await marketCls.validUpdatePositionFromOrder({ price: 40000 + 501 })
    });

    for (let index001 = 0; index001 < 2; index001++) {
        const useFundFee = (index001 == 0)

        it("两个市价单单,都带了止盈止损, 两个止盈同时被触发, 检查fee和用户收到的钱对不对", async function () {

            // 设置市场价格为 40000
            await marketCls.setPrice(40000)
            for (let index002 = 0; index002 < 2; index002++) {
                // 增加市场单：买入 9000 手，价格为 40000，支付 1000
                await marketCls.increaseMarket({
                    price: 40000,
                    tp: 40000 + 500,
                    sl: 40000 - 500,
                    pay: 100,
                    size: 500
                })
            }

            let ff = "0.0"
            if (useFundFee) {
                // add some fund fee
                await marketCls.advanceOneDay({})
                await marketCls.updateFundFee()
                // 查询资金费
                ff = await marketCls.getFundFee({})
                expect(parseFloat(ff), "资金费大于0").gt(0.0)
            }
            // 设置市场价格为 40000 + 501，此时上述卖单被自动平仓触发
            await marketCls.setPrice(40000 + 501)
            // 检查平仓后是否只有一张已关闭的订单
            await marketCls.checkOrdersToExecute({ num: 2, isOpen: false })//
            // 执行自动平仓函数
            await marketCls.runAutoClose()
            //==============================
            //           VALID
            //==============================
            // 检查订单数量是否为 0
            await marketCls.validSize(0)
            await marketCls.validFundFee({ amount: "0.0" })
            await marketCls.validEvent({
                num: 4,
                name: "DeleteOrder"
            })

            // ff=9.99984
            const fees0 = 0.5//手续费
                + 2// 执行费
                + parseFloat(ff)//资金费
            const fees1 = 0.5//手续费
                + 2 //执行费
            await marketCls.validFeeVaultReceive(fees0)//12499840=12.49984
            await marketCls.validFeeVaultReceive(fees1)//2500000=2.5
        });

        it("4个trigger单,其中三个没有触发,某一个触发自动平仓,并检查资金变化", async function () {
            // 设置市场价格为 40000
            await marketCls.setPrice(40000)
            // 增加市场单：买入 9000 手，价格为 40000，支付 1000
            await marketCls.increaseMarket({
                price: 40000,
                pay: 1000,
                size: 9000
            })
            let ff = "0.0"
            if (useFundFee) {
                // add some fund fee
                await marketCls.advanceOneDay({})
                await marketCls.updateFundFee()
                // 查询资金费
                ff = await marketCls.getFundFee({})
                expect(parseFloat(ff), "资金费大于0").gt(0.0)
            }

            for (let index = 0; index < 3; index++) {
                await marketCls.decreaseLimit({
                    price: 40000 + 700,
                    pay: 10,
                    size: 100
                })
            }

            // 增加限价单：卖出 9000 手，价格为 40000 + 500，支付 1000
            await marketCls.decreaseLimit({
                price: 40000 + 500,
                pay: 1000,
                size: 9000
            })
            // 设置市场价格为 40000 + 501，此时上述卖单被自动平仓触发
            await marketCls.setPrice(40000 + 501)
            // 检查平仓后是否只有一张已关闭的订单
            await marketCls.checkOrdersToExecute({ num: 1, isOpen: false })//
            // 执行自动平仓函数
            await marketCls.runAutoClose()

            //==============================
            //           VALID
            //==============================

            await marketCls.validFundFee({ amount: "0.0" })
            await marketCls.validEvent({
                num: 4,
                name: "DeleteOrder"
            })

            // 检查订单数量是否为 0
            await marketCls.validSize(0)
            // 计算资金变化，预期平仓盈亏为 9000 * 501.0 / 40000 = 112.5
            const pnl = 9000 * 501.0 / 40000
            // 检查交易所资金转出是否正确
            await marketCls.validVaultTransferOut(pnl) // 112.5
            // 检查交易所手续费收入是否正确，手续费为 9 + 1 = 10
            const fees = 9 + 1 + 3
            await marketCls.validFeeVaultReceive(fees + parseFloat(ff))

            // 检查用户账户资金变化是否正确，预期变化为 1000 + pnl - 9 - fees
            await marketCls.validBalanceChange(1000 + pnl - 9 - fees - parseFloat(ff))
            // 检查事件中的价格
            await marketCls.validUpdatePositionFromOrder({ price: 40000 + 501 })
        });

    }

})
