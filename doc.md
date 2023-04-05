
## Market(从MarketFactory获取)
###  size/pay/collateral的计算公式(传参)

**第一种情况**

假设前端价格是从我们的预言机获取

size = 预言机price * tokenDigits / 预言机价格精度

举个例子

假设当前eth/usdc = 1200

预言机返回价格 =  `1200*10^30`

tokendigits返回精度 = 18

预言机价格精度 = 30

size = 1200*10^30 * 10^18 / 10^30

**第2种情况**

假设前端价格是从中心化交易所获取

size = 预言机price * tokenDigits

举个例子

假设当前eth/usdc = 1200.1234

中心化交易所返回价格 =  `1200.1234`

tokendigits返回精度 = 18

size = 1200.1234 * 10^18

## size/pay/collateral的计算公式(展示)

展示头寸 = size / tokenDigits

举个例子

用户在ethusdc=1200美元的时候,买入价值12000的头寸

假设 tokenDigits=18

那么从后端获取的size = 12000 * math.power(10, tokenDigits)

前端应该展示 = 从获取后端的size / math.power(10, tokenDigits)

同理,pay,collateral也一样


## price的计算公式(传参)

**第一种情况**

假设前端价格是从我们的预言机获取

无需处理,直接传入接口即可

**第2种情况**

假设前端价格是从中心化交易所获取

price = 预言机price * 10^30

举个例子

假设当前eth/usdc = 1200.1234

中心化交易所返回价格 =  `1200.1234`

price = 1200.1234 * 10^30

## price的计算公式(预言机价格展示)

假设前端价格是从我们的预言机获取

price = 预言机price / 预言机价格精度

举个例子

假设当前eth/usdc = 1200.1234

预言机返回价格 =  `1200*10^30`

展示价格则为 = 1200 * 10^30 / 10^30 (保留多少小数位请看产品文档)

## slippage的计算公式(传参)
假设当前用户设置的滑点为x%(假设前端的展示是百分号)

slipage = x * slippageDigits / 100

举个例子

当前用户设置3%滑点

slipage = 3 * slippageDigits / 100

备注: slippageDigits为常量,任何market都一样,当前代码写死为10000

## increaseTrade(限价/市价开仓)

```
function increaseTrade(
  bool isLimit, // 限价单否
  uint256 payDelta, // 用户支付pay
  uint256 sizeDelta, // 头寸
  uint256 price, // 市价单传预言机价格/限价单传用户填写的价格, 
  uint256 tpPrice, // 止盈
  uint256 slPrice, // 止损
  uint256 slippage, // 滑点
  bool isLong, // 多/空
)
error {
  // internal error
  // validation error
  // busi error
}
```
