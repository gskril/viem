import type { Address } from 'abitype'

import type { Client } from '../../clients/createClient.js'
import type { Transport } from '../../clients/transports/createTransport.js'
import {
  textResolverAbi,
  universalResolverResolveArrayAbi,
} from '../../constants/abis.js'
import type { Chain } from '../../types/chain.js'
import type { Prettify } from '../../types/utils.js'
import { decodeFunctionResult } from '../../utils/abi/decodeFunctionResult.js'
import { encodeFunctionData } from '../../utils/abi/encodeFunctionData.js'
import { getChainContractAddress } from '../../utils/chain.js'
import { toHex } from '../../utils/encoding/toHex.js'
import { isNullUniversalResolverError } from '../../utils/ens/errors.js'
import { namehash } from '../../utils/ens/namehash.js'
import { packetToBytes } from '../../utils/ens/packetToBytes.js'
import {
  type ReadContractParameters,
  readContract,
} from '../public/readContract.js'

/**
 * Recommended Keys for ENS Text Records
 */
export type RecommendedKey =
  | 'url'
  | 'name'
  | 'email'
  | 'header'
  | 'avatar'
  | 'location'
  | 'timezone'
  | 'language'
  | 'pronouns'
  | 'com.github'
  | 'org.matrix'
  | 'io.keybase'
  | 'description'
  | 'com.twitter'
  | 'com.discord'
  | 'social.bsky'
  | 'org.telegram'
  | 'social.mastodon'

/** Allows users to specify their own keys, but also get recommended the keys above */
export type RecordKey = RecommendedKey | (string & {})

/** Allows users to specify a single key or an array of keys */
export type RecordKeyOrKeys<TKeys extends RecordKey> = TKeys | TKeys[]

/** Parameters for {@link getEnsText} */
export type GetEnsTextParameters<
  TKeys extends RecordKeyOrKeys<TRecordKeys>,
  TRecordKeys extends RecordKey,
> = Prettify<
  Pick<ReadContractParameters, 'blockNumber' | 'blockTag'> & {
    /** ENS name to get Text for. */
    name: string
    /** Text record(s) to retrieve. */
    key: TKeys
    /** Address of ENS Universal Resolver Contract. */
    universalResolverAddress?: Address
  }
>

/** Return type for {@link getEnsText} */
export type GetEnsTextReturnType<TKeys extends RecordKeyOrKeys<RecordKey>> =
  | (TKeys extends RecordKey ? string : { [K in TKeys[number]]: string | null })
  | null

/**
 * Gets a text record(s) for specified ENS name.
 *
 * - Docs: https://viem.sh/docs/ens/actions/getEnsResolver.html
 * - Examples: https://stackblitz.com/github/wagmi-dev/viem/tree/main/examples/ens
 *
 * Calls `resolve(bytes, bytes)` on ENS Universal Resolver Contract.
 *
 * Since ENS names prohibit certain forbidden characters (e.g. underscore) and have other validation rules, you likely want to [normalize ENS names](https://docs.ens.domains/contract-api-reference/name-processing#normalising-names) with [UTS-46 normalization](https://unicode.org/reports/tr46) before passing them to `getEnsAddress`. You can use the built-in [`normalize`](https://viem.sh/docs/ens/utilities/normalize.html) function for this.
 *
 * @param client - Client to use
 * @param parameters - {@link GetEnsTextParameters}
 * @returns Text Record(s) for ENS name. {@link GetEnsTextReturnType}
 *
 * @example
 * import { createPublicClient, http } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { getEnsText, normalize } from 'viem/ens'
 *
 * const client = createPublicClient({
 *   chain: mainnet,
 *   transport: http(),
 * })
 * const twitterRecord = await getEnsText(client, {
 *   name: normalize('wagmi-dev.eth'),
 *   key: 'com.twitter',
 * })
 * // 'wagmi_sh'
 */
export async function getEnsText<
  TChain extends Chain | undefined,
  TKeys extends RecordKeyOrKeys<TRecordKeys>,
  TRecordKeys extends RecordKey,
>(
  client: Client<Transport, TChain>,
  {
    blockNumber,
    blockTag,
    name,
    key,
    universalResolverAddress: universalResolverAddress_,
  }: GetEnsTextParameters<TKeys, TRecordKeys>,
): Promise<GetEnsTextReturnType<TKeys>> {
  let universalResolverAddress = universalResolverAddress_
  if (!universalResolverAddress) {
    if (!client.chain)
      throw new Error(
        'client chain not configured. universalResolverAddress is required.',
      )

    universalResolverAddress = getChainContractAddress({
      blockNumber,
      chain: client.chain,
      contract: 'ensUniversalResolver',
    })
  }

  // If a single key is passed, push it into an array so we can use the same logic for both cases
  const keys: TRecordKeys[] = Array.isArray(key) ? key : [key as TRecordKeys]

  try {
    const res = await readContract(client, {
      address: universalResolverAddress,
      abi: universalResolverResolveArrayAbi,
      functionName: 'resolve',
      args: [
        toHex(packetToBytes(name)),
        keys.map((k) =>
          encodeFunctionData({
            abi: textResolverAbi,
            functionName: 'text',
            args: [namehash(name), k],
          }),
        ),
      ],
      blockNumber,
      blockTag,
    })

    const decodedRecords = {} as Record<TRecordKeys, string | null>

    for (let i = 0; i < res[0].length; i++) {
      const encodedRecord = res[0][i]
      const queriedKey = keys[i]

      if (encodedRecord === '0x') {
        decodedRecords[queriedKey] = null
        continue
      }

      const record = decodeFunctionResult({
        abi: textResolverAbi,
        functionName: 'text',
        data: encodedRecord,
      })

      decodedRecords[queriedKey] = record === '' ? null : record
    }

    return (
      keys.length === 1 ? decodedRecords[key as TRecordKeys] : decodedRecords
    ) as GetEnsTextReturnType<TKeys>
  } catch (err) {
    if (isNullUniversalResolverError(err, 'resolve')) return null
    throw err
  }
}
